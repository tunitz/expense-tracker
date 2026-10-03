import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { openDb } from './db';
import { buildServer } from './main';

describe('client contract', () => {
  it('every API path the web client calls exists on the server', async () => {
    const apiFile = join(
      pathDirname(import.meta.filename),
      '../../web/src/lib/api.ts',
    );
    const src = readFileSync(apiFile, 'utf-8');

    // Extract every string literal that starts with '/api/'
    // Handles both single-quoted and backtick strings
    const extracted = new Set<string>();
    const re = /['"`]\/api\/[^'"`${}]*[^'"`${}?]*[?]?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      let path = m[0].slice(1); // strip quote
      // Strip template literal interpolation and trailing query
      const braceIdx = path.indexOf('${');
      if (braceIdx !== -1) path = path.slice(0, braceIdx);
      const qIdx = path.indexOf('?');
      if (qIdx !== -1) path = path.slice(0, qIdx);
      // Remove trailing slash
      if (path.endsWith('/')) path = path.slice(0, -1);
      extracted.add(path);
    }

    const paths = [...extracted];
    expect(paths.length).toBeGreaterThan(0);
    // The test should catch the known bad path
    expect(paths.some((p) => p.startsWith('/api/private/documents'))).toBe(
      true,
    );

    const webDir = join(pathDirname(import.meta.filename), '../../web');
    const db = openDb(':memory:');
    const app = buildServer(db, { webDir });

    // Register a user to get an auth cookie for private routes
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'contract-test@example.com',
        password: 'password123',
      }),
    });
    expect(regRes.status).toBe(201);
    const cookie = regRes.headers.get('set-cookie');
    expect(cookie).not.toBeNull();

    // Login to get a stable session cookie
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'contract-test@example.com',
        password: 'password123',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginCookie = loginRes.headers.get('set-cookie');
    expect(loginCookie).not.toBeNull();

    const methodOrder = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'];

    for (const path of paths) {
      // For private routes, use the auth cookie
      const headers: Record<string, string> = {};
      if (path.startsWith('/api/private')) {
        headers.Cookie = loginCookie!;
      }

      // Try each HTTP method; pass if ANY returns non-404
      let found = false;
      for (const method of methodOrder) {
        try {
          const res = await app.request(path, { method, headers });
          if (res.status !== 404) {
            found = true;
            break;
          }
        } catch {
          // e.g. TypeError from form-data parse mismatch means the route
          // matched but the handler crashed — route exists, pass it.
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(`path ${path} returned 404 for all methods`);
      }
    }
  });
});
