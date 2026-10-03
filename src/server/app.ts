import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Database } from 'bun:sqlite';
import {
  register,
  login,
  logout,
  getSessionUser,
  AuthError,
} from './auth';

export type AppEnv = { Variables: { user: { id: string; email: string } } };

export function createApp(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // In-memory rate limiter: IP -> array of request timestamps
  const rateLimitMap = new Map<string, number[]>();

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const timestamps = rateLimitMap.get(ip) ?? [];
    const recent = timestamps.filter((t) => now - t < 60_000);
    if (recent.length >= 10) {
      rateLimitMap.set(ip, recent);
      return true;
    }
    recent.push(now);
    rateLimitMap.set(ip, recent);
    return false;
  }

  // POST /api/auth/register
  app.post('/api/auth/register', async (c) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (checkRateLimit(ip)) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    if (process.env.ALLOW_SIGNUP === '0') {
      return c.json({ error: 'signup_disabled' }, 403);
    }
    let body: { email?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
    let result: { id: string; email: string };
    try {
      result = await register(db, body.email!, body.password!);
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === 'email_taken') {
          return c.json({ error: 'email_taken' }, 409);
        }
        return c.json({ error: err.code }, 400);
      }
      throw err;
    }
    const session = await login(db, body.email!, body.password!);
    setCookie(c, 'sid', session.token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 24 * 3600,
      secure: process.env.COOKIE_SECURE === '1',
    });
    return c.json({ id: result.id, email: result.email }, 201);
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (c) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (checkRateLimit(ip)) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    let body: { email?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
    try {
      const session = await login(db, body.email!, body.password!);
      const normalizedEmail = body.email!.trim().toLowerCase();
      setCookie(c, 'sid', session.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 30 * 24 * 3600,
        secure: process.env.COOKIE_SECURE === '1',
      });
      return c.json(
        { id: session.userId, email: normalizedEmail },
        200,
      );
    } catch (err) {
      if (err instanceof AuthError && err.code === 'invalid_credentials') {
        return c.json({ error: 'invalid_credentials' }, 401);
      }
      throw err;
    }
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, 'sid');
    if (token) {
      logout(db, token);
      deleteCookie(c, 'sid');
    }
    return c.body(null, 204);
  });

  // requireUser middleware
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const token = getCookie(c, 'sid');
    const user = getSessionUser(db, token);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
  });

  // GET /api/me
  app.get('/api/me', requireUser, (c) => {
    const user = c.get('user');
    return c.json({ id: user.id, email: user.email }, 200);
  });

  // Register requireUser for /api/private/*
  app.use('/api/private/*', requireUser);

  return app;
}
