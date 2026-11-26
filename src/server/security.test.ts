import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { openDb } from './db';
import { createApp } from './app';
import { buildServer } from './main';

const JSON_HDR = { 'Content-Type': 'application/json' };

function post(app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { ...JSON_HDR, ...headers },
    body: JSON.stringify(body),
  });
}

function blankPdf(pages: number): Uint8Array {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('login rate limiting', () => {
  let app: ReturnType<typeof createApp>;
  const saved = process.env.TRUST_PROXY;

  beforeEach(() => {
    app = createApp(openDb(':memory:'));
    delete process.env.TRUST_PROXY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
  });

  it('spoofed X-Forwarded-For does not bypass the limit when no proxy is trusted', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await post(app, '/api/auth/login', { email: 'a@b.co', password: 'wrongwrong' }, { 'x-forwarded-for': `10.0.0.${i}` });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('honours X-Forwarded-For when TRUST_PROXY=1', async () => {
    process.env.TRUST_PROXY = '1';
    for (let i = 0; i < 12; i++) {
      const res = await post(app, '/api/auth/login', { email: `u${i}@b.co`, password: 'wrongwrong' }, { 'x-forwarded-for': `10.0.1.${i}` });
      expect(res.status).toBe(401);
    }
  });

  it('locks one account after repeated failures even from many IPs', async () => {
    process.env.TRUST_PROXY = '1';
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await post(app, '/api/auth/login', { email: 'victim@b.co', password: 'wrongwrong' }, { 'x-forwarded-for': `10.0.2.${i}` });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('register and login do not share a rate-limit bucket', async () => {
    for (let i = 0; i < 10; i++) {
      await post(app, '/api/auth/login', { email: `x${i}@b.co`, password: 'wrongwrong' });
    }
    const res = await post(app, '/api/auth/register', { email: 'new@b.co', password: 'longenoughpw' });
    expect(res.status).toBe(201);
  });
});

describe('input validation', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp(openDb(':memory:'));
  });

  it('login with non-string email/password returns 400, not 500', async () => {
    const res = await post(app, '/api/auth/login', { email: 123, password: 456 });
    expect(res.status).toBe(400);
  });

  it('register rejects a password longer than 128 chars', async () => {
    const res = await post(app, '/api/auth/register', { email: 'long@b.co', password: 'x'.repeat(200) });
    expect(res.status).toBe(400);
  });

  it('login rejects a password longer than 128 chars without hashing it', async () => {
    const res = await post(app, '/api/auth/login', { email: 'long@b.co', password: 'x'.repeat(200) });
    expect(res.status).toBe(401);
  });
});

describe('login timing', () => {
  it('unknown email costs about as much as a known one', async () => {
    process.env.TRUST_PROXY = '1';
    const app = createApp(openDb(':memory:'));
    await post(app, '/api/auth/register', { email: 'real@b.co', password: 'longenoughpw' }, { 'x-forwarded-for': '1.1.1.1' });
    const median = async (email: string, base: number) => {
      const t: number[] = [];
      for (let i = 0; i < 5; i++) {
        const s = performance.now();
        await post(app, '/api/auth/login', { email, password: 'wrongwrong' }, { 'x-forwarded-for': `2.2.${base}.${i}` });
        t.push(performance.now() - s);
      }
      return t.sort((a, b) => a - b)[2];
    };
    const known = await median('real@b.co', 1);
    const unknown = await median('ghost@b.co', 2);
    delete process.env.TRUST_PROXY;
    expect(unknown! / known!).toBeGreaterThan(0.7);
  });
});

describe('server hardening', () => {
  let webDir: string;
  beforeEach(() => {
    webDir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'sec-'));
    writeFileSync(join(webDir, 'index.html'), '<html>idx</html>');
  });
  afterEach(() => rmSync(webDir, { recursive: true, force: true }));

  it('sends a Content-Security-Policy', async () => {
    const app = buildServer(openDb(':memory:'), { webDir });
    const res = await app.request('/');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sends HSTS only when COOKIE_SECURE=1', async () => {
    const app = buildServer(openDb(':memory:'), { webDir });
    expect((await app.request('/')).headers.get('Strict-Transport-Security')).toBeNull();
    process.env.COOKIE_SECURE = '1';
    const res = await app.request('/');
    delete process.env.COOKIE_SECURE;
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
  });

  it('malformed percent-encoding returns 400, not 500', async () => {
    const app = buildServer(openDb(':memory:'), { webDir });
    const res = await app.request('/%');
    expect(res.status).toBe(400);
  });

  it('database file is created owner-only (0600)', () => {
    const p = join(webDir, 'app.db');
    const db = openDb(p);
    db.run('CREATE TABLE IF NOT EXISTS t(x)');
    db.close();
    expect(statSync(p).mode & 0o077).toBe(0);
  });

  it('rejects a PDF with more than 50 pages', async () => {
    const app = buildServer(openDb(':memory:'), { webDir });
    const reg = await post(app, '/api/auth/register', { email: 'pdf@b.co', password: 'longenoughpw' });
    const cookie = (reg.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const fd = new FormData();
    fd.append('file', new File([blankPdf(51)], 'big.pdf', { type: 'application/pdf' }));
    const res = await app.request('/api/private/documents', { method: 'POST', headers: { cookie }, body: fd });
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('too_many_pages');
  });
});
