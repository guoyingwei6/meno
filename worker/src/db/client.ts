export interface WorkerBindings {
  DB: D1Database;
  ASSETS: R2Bucket;
  APP_ORIGIN: string;
  API_ORIGIN: string;
  ASSET_PUBLIC_BASE_URL: string;
  GITHUB_ALLOWED_LOGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  API_TOKEN?: string;
}
