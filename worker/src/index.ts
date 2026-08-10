import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { aiRoutes } from './routes/ai';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { memoRoutes } from './routes/memos';
import { publicRoutes } from './routes/public';
import { quickApiRoutes } from './routes/quick-api';
import { mcpRoutes } from './routes/mcp';
import { uploadRoutes } from './routes/upload';
import { v1Routes } from './routes/v1';
import { createOpenApiDocument } from './contracts/openapi';
import { getAssetResponse } from './storage/r2';
import type { WorkerBindings } from './db/client';
import { isAllowedOrigin, resolveAuthorSession } from './lib/auth';
import { resolveAssetReadPolicy } from './lib/asset-access';
import { PRIVATE_ASSET_CACHE_CONTROL } from './storage/r2';

export const app = new Hono<{ Bindings: WorkerBindings }>();

const COOKIE_AUTH_EXCLUSIONS = [
  '/api/me',
  '/api/auth',
  '/api/public',
  '/api/assets',
  '/api/quick',
  '/api/mcp',
  '/api/v1',
] as const;

const isCookieProtectedPath = (pathname: string) => {
  if (!pathname.startsWith('/api/')) return false;
  return !COOKIE_AUTH_EXCLUSIONS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
};

const isMutationMethod = (method: string) => {
  return method === 'POST' || method === 'PATCH' || method === 'DELETE';
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src https://github.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data: https:",
  "script-src 'self'",
].join('; ');

// These headers apply to JSON, OAuth redirects, and R2 image/audio responses
// returned through this Worker. The permissive resource schemes are
// intentional: the UI loads user-authored images/audio and can call a
// user-configured Workers AI/OpenAI-compatible endpoint.
app.use('*', async (c, next) => {
  c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cross-Origin-Resource-Policy', 'cross-origin');
  await next();
});

app.use('/api/*', cors({
  origin: (origin, c) => isAllowedOrigin(c.env, origin) ? origin : undefined,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'X-API-Key'],
  credentials: true,
}));

/**
 * The individual route modules retain their historical cookie-presence guard,
 * but this middleware is the authoritative D1 check. It covers every
 * cookie-authenticated route (memos, uploads, dashboard, and AI) without
 * changing the API-token namespaces (quick/v1/MCP) or public asset endpoints.
 */
app.use('/api/*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (!isCookieProtectedPath(pathname) || c.req.method === 'OPTIONS') {
    await next();
    return;
  }

  const session = await resolveAuthorSession(c.env, c.req.header('Cookie'));
  if (!session) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  if (isMutationMethod(c.req.method) && !isAllowedOrigin(c.env, c.req.header('Origin'))) {
    return c.json({ message: 'Invalid origin' }, 403);
  }

  await next();
});

app.get('/openapi.json', (c) => c.json(createOpenApiDocument()));
app.route('/api/public', publicRoutes);
app.route('/api', authRoutes);
app.route('/api', memoRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api', uploadRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/quick', quickApiRoutes);
app.route('/api/mcp', mcpRoutes);
app.route('/api/v1', v1Routes);

// Fallback: serve old image URLs at /assets/* (before prefix was changed to /api/assets/*)
app.get('/assets/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const policy = await resolveAssetReadPolicy(c.env, key, c.req.header('Cookie'));
  if (!policy.allowed) {
    return c.json({ message: 'Asset not found' }, 404);
  }
  const response = await getAssetResponse((c.env as { ASSETS: R2Bucket }).ASSETS, key, c.req.header('Range'), { cacheControl: policy.cacheControl });
  if (!response) {
    return c.json({ message: 'Asset not found' }, 404);
  }
  response.headers.set('Cross-Origin-Resource-Policy', policy.cacheControl === PRIVATE_ASSET_CACHE_CONTROL ? 'same-site' : 'cross-origin');
  return response;
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: import('./db/client').WorkerBindings) {
    const { purgeOldTrash, backupMemosToR2 } = await import('./db/memo-repository');
    const { purgeOrphanAssets, purgeUntrackedR2Uploads } = await import('./db/asset-repository');
    const { processMemoImageOcrQueue } = await import('./lib/image-ocr');
    const { processVoiceNoteQueue } = await import('./lib/voice-transcription');
    const { processKnowledgeSyncQueue } = await import('./lib/knowledge-sync-queue');
    await purgeOldTrash(env.DB, env.ASSETS);
    await purgeOrphanAssets(env.DB, env.ASSETS);
    await purgeUntrackedR2Uploads(env.DB, env.ASSETS);
    await backupMemosToR2(env.DB, env.ASSETS);
    await processMemoImageOcrQueue(env);
    await processVoiceNoteQueue(env);
    await processKnowledgeSyncQueue(env);
  },
};
