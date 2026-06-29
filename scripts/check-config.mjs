import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localConfigPath = resolve(rootDir, 'worker/wrangler.local.toml');
const templateConfigPath = resolve(rootDir, 'worker/wrangler.toml');
const deployMode = process.argv.includes('--deploy');

const errors = [];
const warnings = [];

const readConfig = (path) => {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, 'utf8');
};

const localConfig = readConfig(localConfigPath);
const templateConfig = readConfig(templateConfigPath);

const addError = (message) => errors.push(message);
const addWarning = (message) => warnings.push(message);

const hasSection = (source, section) => {
  const escaped = section.replaceAll('[', '\\[').replaceAll(']', '\\]');
  return new RegExp(`^${escaped}\\s*$`, 'm').test(source);
};

const readValue = (source, key) => {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`, 'm');
  return source.match(pattern)?.[1] ?? null;
};

const isPlaceholder = (value) => {
  if (!value) {
    return true;
  }
  const normalized = value.toLowerCase();
  return normalized.includes('your-')
    || normalized.includes('example')
    || normalized.includes('placeholder')
    || normalized.includes('你的')
    || normalized === 'change-me'
    || normalized === 'change-me-before-production';
};

if (!localConfig) {
  addError('worker/wrangler.local.toml is missing. Deployment must use the local config, not worker/wrangler.toml.');
} else {
  for (const section of ['[ai]', '[[d1_databases]]', '[[r2_buckets]]', '[[vectorize]]', '[vars]']) {
    if (!hasSection(localConfig, section)) {
      addError(`worker/wrangler.local.toml is missing ${section}.`);
    }
  }

  const requiredValues = [
    ['name', 'Worker name'],
    ['main', 'Worker entrypoint'],
    ['compatibility_date', 'Worker compatibility date'],
    ['database_id', 'D1 database id'],
    ['bucket_name', 'R2 bucket name'],
    ['index_name', 'Vectorize index name'],
    ['APP_ORIGIN', 'frontend origin'],
    ['API_ORIGIN', 'worker API origin'],
    ['ASSET_PUBLIC_BASE_URL', 'asset public base URL'],
    ['GITHUB_ALLOWED_LOGIN', 'allowed GitHub login'],
    ['GITHUB_CLIENT_ID', 'GitHub OAuth client id'],
  ];

  for (const [key, label] of requiredValues) {
    const value = readValue(localConfig, key);
    if (isPlaceholder(value)) {
      addError(`${label} (${key}) is missing or still a placeholder in worker/wrangler.local.toml.`);
    }
  }

  for (const key of ['GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'API_TOKEN']) {
    const value = readValue(localConfig, key);
    if (!value) {
      addWarning(`${key} is not present in worker/wrangler.local.toml. Make sure it is configured as a Wrangler secret before deploy.`);
    } else if (isPlaceholder(value)) {
      const message = `${key} appears to be a placeholder. Set a real secret before production deploy.`;
      if (deployMode) {
        addError(message);
      } else {
        addWarning(message);
      }
    } else {
      const message = `${key} is present in worker/wrangler.local.toml. Move it to Wrangler secrets before deploy because Wrangler may print [vars] values during dry-run/deploy. Value was not printed by this checker.`;
      if (deployMode) {
        addError(message);
      } else {
        addWarning(message);
      }
    }
  }
}

if (!templateConfig) {
  addWarning('worker/wrangler.toml is missing. This is acceptable for local deploys, but README examples may need updating.');
} else {
  const templateDatabaseId = readValue(templateConfig, 'database_id');
  if (!isPlaceholder(templateDatabaseId)) {
    addWarning('worker/wrangler.toml appears to contain a real database_id. Keep real deployment values in worker/wrangler.local.toml only.');
  }
}

if (warnings.length > 0) {
  console.log('Config warnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (errors.length > 0) {
  console.error('Config errors:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(deployMode ? 'Deploy config check passed.' : 'Config check passed.');
