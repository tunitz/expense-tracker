import { Hono } from 'hono';
import { join, resolve } from 'path';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import type { Database } from 'bun:sqlite';
import type { AppEnv } from './app';
import { createApp } from './app';
import { openDb } from './db';
import { documentsRoutes } from './routes/documents';
import { transactionsRoutes } from './routes/transactions';

export function buildServer(db: Database, opts: { webDir: string }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const webDir = resolve(opts.webDir);

  // Security headers on every response — register FIRST so all routes inherit
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (process.env.COOKIE_SECURE === '1') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  // Mount the base app (auth routes, /api/me, requireUser on /api/private/*)
  const baseApp = createApp(db);
  app.route('', baseApp);

  app.route('/api/private/documents', documentsRoutes(db));
  app.route('/api/private/transactions', transactionsRoutes(db));

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Catch-all for unknown /api/* paths => 404 JSON
  app.get('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  // Static / SPA serving for non-/api paths
  app.get('*', async (c) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    // Guard against path traversal: decode and resolve
    let safePath: string;
    try {
      safePath = decodeURIComponent(pathname);
    } catch {
      return c.text('Bad request', 400);
    }
    if (safePath.includes('\0')) return c.text('Bad request', 400);
    const fullPath = join(webDir, safePath);

    // Verify resolved path starts with webDir
    if (!fullPath.startsWith(webDir + '/')) {
      return c.text('Not found', 404);
    }

    if (existsSync(fullPath)) {
      // Skip directories (fall through to SPA fallback)
      if (statSync(fullPath).isDirectory()) {
        const indexPath = join(webDir, 'index.html');
        if (existsSync(indexPath)) {
          const body = readFileSync(indexPath, 'utf-8');
          return c.html(body, 200, { 'Cache-Control': 'no-cache' });
        }
        return c.text('web not built', 404);
      }
      const isAsset = safePath.startsWith('/assets/');
      const res = new Response(Bun.file(fullPath));
      if (isAsset) {
        res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return res;
    }

    // SPA fallback: serve index.html
    const indexPath = join(webDir, 'index.html');
    if (existsSync(indexPath)) {
      const body = readFileSync(indexPath, 'utf-8');
      return c.html(body, 200, { 'Cache-Control': 'no-cache' });
    }

    return c.text('web not built', 404);
  });

  return app;
}

// ── Entry point (only when run directly) ──
if (import.meta.main) {
  const dataDir = process.env.DATA_DIR ?? './data';
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const db = openDb(join(dataDir, 'app.db'));
  let server: Bun.Server<any>;
  server = Bun.serve({
    port: Number(process.env.PORT ?? 3020),
    hostname: '0.0.0.0',
    fetch: buildServer(db, { webDir: process.env.WEB_DIR ?? './web/dist' }).fetch,
    maxRequestBodySize: 20 * 1024 * 1024,
  });
  console.log(`listening on ${server.port}`);

  // Hourly session cleanup
  setInterval(() => {
    db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  }, 60 * 60 * 1000);
}
