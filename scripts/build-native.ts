import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.EXPENSE_CP037_MODE !== 'js') {
  const crate = join(import.meta.dir, '..', 'rust', 'statement-cp037');
  const target = join(crate, 'target');
  const cargo = Bun.which('cargo');
  if (!cargo) {
    console.error('Install Rust 1.97+ to build the statement decoder, or set EXPENSE_CP037_MODE=js.');
    process.exit(1);
  }

  const filenames: Record<string, string> = {
    linux: 'libstatement_cp037.so',
    darwin: 'libstatement_cp037.dylib',
    win32: 'statement_cp037.dll',
  };
  const filename = filenames[process.platform];
  if (!filename) {
    console.error('Unsupported native build platform; set EXPENSE_CP037_MODE=js.');
    process.exit(1);
  }

  const { exitCode } = Bun.spawnSync(
    [cargo, 'build', '--release', '--locked', '--target-dir', target],
    { cwd: crate, stdio: ['inherit', 'inherit', 'inherit'] },
  );
  if (exitCode !== 0) process.exit(exitCode);
  copyFileSync(join(target, 'release', filename), join(crate, 'statement_cp037.node'));
}
