export interface WorkerBindings {
  DB: D1Database;
  ASSETS: R2Bucket;
  AI?: {
    run: (model: string, input: unknown) => Promise<unknown>;
    toMarkdown?: (input: unknown) => Promise<unknown>;
  };
  VECTORIZE?: {
    upsert: (vectors: unknown[]) => Promise<unknown>;
    query: (vector: number[], options?: Record<string, unknown>) => Promise<unknown>;
    deleteByIds?: (ids: string[]) => Promise<unknown>;
  };
  OCR_DAILY_LIMIT?: string;
  OCR_BATCH_SIZE?: string;
  OCR_SEED_BATCH_SIZE?: string;
  APP_ORIGIN: string;
  API_ORIGIN: string;
  ASSET_PUBLIC_BASE_URL: string;
  GITHUB_ALLOWED_LOGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  API_TOKEN?: string;
}
