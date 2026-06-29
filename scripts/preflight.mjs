import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  ['Config check', ['npm', ['run', 'config:check']]],
  ['Type check', ['npm', ['run', 'typecheck']]],
  ['Tests', ['npm', ['run', 'test']]],
];

for (const [label, [command, args]] of steps) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`\nPreflight failed at: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nPreflight passed.');
