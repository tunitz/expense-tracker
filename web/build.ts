import tailwind from 'bun-plugin-tailwind';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';

const webDir = import.meta.dir;
const outdir = path.join(webDir, 'dist');
const publicDir = path.join(webDir, 'public');

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [path.join(webDir, 'index.html')],
  outdir,
  plugins: [tailwind],
  minify: true,
  target: 'browser',
  publicPath: '/',
  tsconfig: path.join(webDir, 'tsconfig.json'),
  naming: {
    chunk: 'assets/[name]-[hash].[ext]',
    asset: 'assets/[name]-[hash].[ext]',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await cp(publicDir, outdir, { recursive: true });

for (const output of result.outputs) {
  console.log(
    ` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`,
  );
}
