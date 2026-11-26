import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import { ensureDefaultCategories } from './categorize';
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

  // In-memory sliding-window rate limiter, one bucket per key
  const buckets = new Map<string, number[]>();

  function hit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
      }
    }
    const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      buckets.set(key, recent);
      return true;
    }
    recent.push(now);
    buckets.set(key, recent);
    return false;
  }

  function clientIp(c: Context): string {
    if (process.env.TRUST_PROXY === '1') {
      // Rightmost entry is the one our own proxy appended; earlier ones are client-supplied.
      const xff = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
      if (xff && xff.length > 0) return xff[xff.length - 1]!;
    }
    try {
      return getConnInfo(c).remote.address ?? 'local';
    } catch {
      return 'local';
    }
  }

  // Failed logins per account, across all IPs
  const failures = new Map<string, number[]>();
  const FAIL_MAX = 10;
  const FAIL_WINDOW = 15 * 60_000;

  function failureCount(email: string): number {
    const now = Date.now();
    const recent = (failures.get(email) ?? []).filter((t) => now - t < FAIL_WINDOW);
    if (recent.length === 0) failures.delete(email);
    else failures.set(email, recent);
    return recent.length;
  }
  function recordFailure(email: string): void {
    const list = failures.get(email) ?? [];
    list.push(Date.now());
    failures.set(email, list);
  }

  async function readCredentials(c: Context): Promise<{ email: string; password: string } | null> {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return null;
    }
    const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string') return null;
    return { email, password };
  }

  // POST /api/auth/register
  app.post('/api/auth/register', async (c) => {
    if (hit(`reg:${clientIp(c)}`, 10, 60_000)) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    if (process.env.ALLOW_SIGNUP === '0') {
      return c.json({ error: 'signup_disabled' }, 403);
    }
    const creds = await readCredentials(c);
    if (!creds) return c.json({ error: 'bad_request' }, 400);
    let result: { id: string; email: string };
    try {
      result = await register(db, creds.email, creds.password);
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === 'email_taken') {
          return c.json({ error: 'email_taken' }, 409);
        }
        return c.json({ error: err.code }, 400);
      }
      throw err;
    }
    ensureDefaultCategories(db, result.id);
    const session = await login(db, creds.email, creds.password);
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
    if (hit(`login:${clientIp(c)}`, 10, 60_000)) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    const creds = await readCredentials(c);
    if (!creds) return c.json({ error: 'bad_request' }, 400);
    const normalizedEmail = creds.email.trim().toLowerCase();
    if (failureCount(normalizedEmail) >= FAIL_MAX) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    try {
      const session = await login(db, creds.email, creds.password);
      failures.delete(normalizedEmail);
      ensureDefaultCategories(db, session.userId);
      setCookie(c, 'sid', session.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 30 * 24 * 3600,
        secure: process.env.COOKIE_SECURE === '1',
      });
      return c.json({ id: session.userId, email: normalizedEmail }, 200);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'invalid_credentials') {
        recordFailure(normalizedEmail);
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
