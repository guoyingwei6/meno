import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) args.set(key.slice(2), value ?? '');
}

const config = args.get('config') || 'worker/wrangler.ci.toml';
const database = args.get('database') || 'meno';
const migrationsDir = args.get('dir') || 'worker/migrations';
const wrangler = process.platform === 'win32' ? 'node_modules/.bin/wrangler.cmd' : './node_modules/.bin/wrangler';

const duplicateColumnTolerated = new Set([
  '002_add_pinned.sql',
  '003_add_favorited.sql',
]);

const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

for (const file of migrationFiles) {
  const filePath = path.join(migrationsDir, file);
  console.log(`Applying D1 migration: ${file}`);
  const result = spawnSync(wrangler, [
    'd1',
    'execute',
    database,
    '--remote',
    '--config',
    config,
    '--file',
    filePath,
  ], {
    env: {
      ...process.env,
      CI: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
    encoding: 'utf8',
  });

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status === 0) {
    continue;
  }
  if (duplicateColumnTolerated.has(file) && /duplicate column name/i.test(output)) {
    console.log(`Skipping already-applied legacy migration: ${file}`);
    continue;
  }

  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('D1 migrations applied.');
