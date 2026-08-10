import { spawnSync } from 'node:child_process';

const options = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) options.set(key.slice(2), value ?? '');
}

const config = options.get('config');
const database = options.get('database') || 'meno';
const target = options.has('remote') ? 'remote' : options.has('local') ? 'local' : null;

if (!target || (options.has('remote') && options.has('local'))) {
  console.error('Specify exactly one migration target: --remote or --local.');
  process.exit(1);
}

if (!config) {
  console.error('Specify --config=<path> explicitly; CI and local verification use different Wrangler configs.');
  process.exit(1);
}

if (target === 'remote' && options.has('persist-to')) {
  console.error('--persist-to is only valid with --local.');
  process.exit(1);
}

const wrangler = process.platform === 'win32' ? 'node_modules/.bin/wrangler.cmd' : './node_modules/.bin/wrangler';
const args = [
  'd1',
  'migrations',
  'apply',
  database,
  `--${target}`,
  '--config',
  config,
];

const persistTo = options.get('persist-to');
if (persistTo) args.push('--persist-to', persistTo);

console.log(`Applying D1 migrations through Wrangler's ledger (${target}): ${database}`);
const result = spawnSync(wrangler, args, {
  env: {
    ...process.env,
    CI: '1',
    WRANGLER_SEND_METRICS: 'false',
  },
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
