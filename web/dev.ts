import path from 'node:path';
import index from './index.html';

const publicDir = path.join(import.meta.dir, 'public');
const apiOrigin = `http://127.0.0.1:${process.env.PORT ?? 3020}`;
const webPort = Number(process.env.WEB_PORT ?? 3000);

const publicRoutes: Record<string, () => Response> = {};
for (const file of new Bun.Glob('**/*').scanSync({ cwd: publicDir, onlyFiles: true })) {
  const fullPath = path.join(publicDir, file);
  const routePath = `/${file.replaceAll('\\', '/')}`;
  publicRoutes[routePath] = () => new Response(Bun.file(fullPath));
}

async function proxyApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = new URL(url.pathname + url.search, apiOrigin);
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.set('accept-encoding', 'identity');

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    return await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
    });
  } catch {
    return Response.json({ error: 'api_unavailable' }, { status: 502 });
  }
}

const server = Bun.serve({
  port: webPort,
  routes: {
    ...publicRoutes,
    '/api/*': proxyApi,
    '/*': index,
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`web dev server listening on ${server.url} (proxying /api -> ${apiOrigin})`);
