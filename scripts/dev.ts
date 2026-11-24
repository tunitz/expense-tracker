import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const web = join(root, 'web');
const children: Bun.Subprocess[] = [];
let stopping = false;

function stop() {
  stopping = true;
  for (const child of children) child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  const stdio: ['inherit', 'inherit', 'inherit'] = ['inherit', 'inherit', 'inherit'];
  children.push(Bun.spawn([process.execPath, '--watch', 'src/server/main.ts'], { cwd: root, stdio }));
  children.push(Bun.spawn([process.execPath, 'run', 'dev.ts'], { cwd: web, stdio }));
  const exitCode = await Promise.race(children.map(child => child.exited));
  process.exitCode = stopping ? 0 : exitCode;
} finally {
  stop();
  await Promise.all(children.map(child => child.exited));
}
