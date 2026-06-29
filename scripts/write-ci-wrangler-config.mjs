import { writeFileSync } from 'node:fs';

const required = [
  'CLOUDFLARE_ACCOUNT_ID',
  'D1_DATABASE_ID',
  'GITHUB_ALLOWED_LOGIN',
  'GITHUB_CLIENT_ID',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required CI variables: ${missing.join(', ')}`);
  process.exit(1);
}

const env = {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  d1DatabaseId: process.env.D1_DATABASE_ID,
  appOrigin: process.env.APP_ORIGIN || 'https://meno.guoyingwei.top',
  apiOrigin: process.env.API_ORIGIN || 'https://api.meno.guoyingwei.top',
  assetPublicBaseUrl: process.env.ASSET_PUBLIC_BASE_URL || 'https://api.meno.guoyingwei.top/api/assets',
  ocrDailyLimit: process.env.OCR_DAILY_LIMIT || '100',
  ocrBatchSize: process.env.OCR_BATCH_SIZE || '10',
  ocrSeedBatchSize: process.env.OCR_SEED_BATCH_SIZE || '10',
  githubAllowedLogin: process.env.GITHUB_ALLOWED_LOGIN,
  githubClientId: process.env.GITHUB_CLIENT_ID,
};

const quote = (value) => JSON.stringify(String(value));

const config = `name = "meno-worker"
main = "src/index.ts"
compatibility_date = "2025-03-24"
account_id = ${quote(env.accountId)}

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "meno"
database_id = ${quote(env.d1DatabaseId)}

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "meno-assets"

[[vectorize]]
binding = "VECTORIZE"
index_name = "meno-memos"

[triggers]
crons = ["0 * * * *"]

[vars]
APP_ORIGIN = ${quote(env.appOrigin)}
API_ORIGIN = ${quote(env.apiOrigin)}
ASSET_PUBLIC_BASE_URL = ${quote(env.assetPublicBaseUrl)}
OCR_DAILY_LIMIT = ${quote(env.ocrDailyLimit)}
OCR_BATCH_SIZE = ${quote(env.ocrBatchSize)}
OCR_SEED_BATCH_SIZE = ${quote(env.ocrSeedBatchSize)}
GITHUB_ALLOWED_LOGIN = ${quote(env.githubAllowedLogin)}
GITHUB_CLIENT_ID = ${quote(env.githubClientId)}
`;

writeFileSync('worker/wrangler.ci.toml', config);
console.log('Wrote worker/wrangler.ci.toml');
