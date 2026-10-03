import { describe, it, expect, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { openDb } from './db';
import { buildServer } from './main';
import type { AppEnv } from './app';

describe('buildServer', () => {
  let webDir: string;
  let server: ReturnType<typeof buildServer>;

  beforeEach(() => {
    webDir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'web-'));
    // Create index.html
    const indexPath = join(webDir, 'index.html');
    writeFileSync(indexPath, '<html>idx</html>');
    // Create an asset file
    const assetDir = join(webDir, 'assets');
    mkdirSync(assetDir, { recursive: true });
    const assetPath = join(assetDir, 'a.js');
    writeFileSync(assetPath, '// asset');
    // Create a nested file
    const nestedDir = join(webDir, 'deep');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'file.txt'), 'nested');
  });

  afterAll(() => {
    if (existsSync(webDir)) {
      rmSync(webDir, { recursive: true, force: true });
    }
  });

  it('GET /api/health returns 200 {ok:true}', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('GET /api/nope returns 404 json', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_found' });
  });

  it('GET /api/private/transactions without cookie => 401', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/api/private/transactions');
    expect(res.status).toBe(401);
  });

  it('GET /api/private/documents without cookie => 401', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/api/private/documents');
    expect(res.status).toBe(401);
  });

  it('GET / returns index text with no-cache', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('idx');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET /assets/a.js returns file with immutable cache header', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/assets/a.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('GET /some/spa/route returns index.html', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/some/spa/route');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('idx');
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('path traversal returns index.html or 404 but NEVER root:', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    // Encoded traversal
    let res = await app.request('/%2e%2e/%2e%2e/etc/passwd');
    expect(res.status).toBeLessThan(500);
    const t1 = await res.text();
    expect(t1).not.toContain('root:');

    // Plain traversal
    res = await app.request('/../../etc/passwd');
    expect(res.status).toBeLessThan(500);
    const t2 = await res.text();
    expect(t2).not.toContain('root:');
  });

  it('security headers present on /api/health', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('security headers present on static serve', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('security headers present on /api/nope', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('full flow: register then GET /api/private/transactions with cookie => 200', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });

    // Register
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'password123',
      }),
    });
    expect(regRes.status).toBe(201);
    const regBody = await regRes.json();
    expect(regBody).toHaveProperty('id');

    // Extract cookie
    const setCookie = regRes.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();

    // GET transactions with cookie
    const txnRes = await app.request('/api/private/transactions', {
      headers: { Cookie: setCookie! },
    });
    expect(txnRes.status).toBe(200);
    const txnBody = (await txnRes.json()) as { items: unknown[]; total: number };
    expect(txnBody).toHaveProperty('items');
    expect(txnBody).toHaveProperty('total');
    expect(txnBody.items).toEqual([]);
    expect(txnBody.total).toBe(0);
  });

  it('web not built when index.html missing', async () => {
    const bareDir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'web-'));
    try {
      const app = buildServer(openDb(':memory:'), { webDir: bareDir });
      const res = await app.request('/');
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toBe('web not built');
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
    }
  });

  it('asset file serves correct content', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/assets/a.js');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('// asset');
  });

  it('non-existent static path falls back to SPA', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/does/not/exist');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('idx');
  });

  it('security headers on 404 SPA fallback', async () => {
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });
    const res = await app.request('/does/not/exist');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
  });
});
