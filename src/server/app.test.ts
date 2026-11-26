import { describe, it, expect, beforeEach } from 'bun:test';
import { openDb } from './db';
import { createApp } from './app';

describe('createApp auth routes', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    app = createApp(db);
  });

  it('register returns 201 and sets a Set-Cookie header with sid and HttpOnly', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'strongpassword',
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { id: string; email: string };
    expect(json.email).toBe('alice@example.com');
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('sid=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('/api/me with cookie returns the email', async () => {
    // Register and capture the session token
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bob@example.com',
        password: 'strongpassword',
      }),
    });
    const setCookie = regRes.headers.get('Set-Cookie');
    const tokenMatch = setCookie?.match(/sid=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : '';
    // Now /api/me with the real cookie
    const res = await app.request('/api/me', {
      method: 'GET',
      headers: { Cookie: `sid=${token}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { email: string };
    expect(json.email).toBe('bob@example.com');
  });

  it('/api/me without cookie returns 401', async () => {
    const res = await app.request('/api/me', { method: 'GET' });
    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('unauthorized');
  });

  it('duplicate register returns 409', async () => {
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dup@example.com',
        password: 'strongpassword',
      }),
    });
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dup@example.com',
        password: 'strongpassword',
      }),
    });
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('email_taken');
  });

  it('wrong password login returns 401', async () => {
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'wrong@example.com',
        password: 'correctpass',
      }),
    });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'wrong@example.com',
        password: 'wrongpass',
      }),
    });
    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('invalid_credentials');
  });

  it('logout then /api/me with old cookie returns 401', async () => {
    // Register
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'logout@example.com',
        password: 'strongpassword',
      }),
    });
    // Capture the session token from the cookie
    const registerRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'logout2@example.com',
        password: 'strongpassword',
      }),
    });
    const setCookie = registerRes.headers.get('Set-Cookie');
    const tokenMatch = setCookie?.match(/sid=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : 'fallback';

    // Logout
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `sid=${token}` },
    });
    expect(logoutRes.status).toBe(204);

    // /api/me with old cookie
    const meRes = await app.request('/api/me', {
      method: 'GET',
      headers: { Cookie: `sid=${token}` },
    });
    expect(meRes.status).toBe(401);
  });

  it('bad JSON body returns 400', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('bad_request');
  });

  it('11th rapid login attempt returns 429', async () => {
    for (let i = 0; i < 10; i++) {
      await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': 'rate-test' },
        body: JSON.stringify({
          email: 'rate@example.com',
          password: 'wrongpassword',
        }),
      });
    }
    // 11th attempt
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': 'rate-test' },
      body: JSON.stringify({
        email: 'rate@example.com',
        password: 'wrongpassword',
      }),
    });
    expect(res.status).toBe(429);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('rate_limited');
  });

  it('ALLOW_SIGNUP=0 returns 403', async () => {
    const orig = process.env.ALLOW_SIGNUP;
    process.env.ALLOW_SIGNUP = '0';
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'blocked@example.com',
        password: 'strongpassword',
      }),
    });
    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('signup_disabled');
    if (orig === undefined) {
      delete process.env.ALLOW_SIGNUP;
    } else {
      process.env.ALLOW_SIGNUP = orig;
    }
  });
});
