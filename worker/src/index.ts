import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { aiRoutes } from './routes/ai';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { memoRoutes } from './routes/memos';
import { publicRoutes } from './routes/public';
import { quickApiRoutes } from './routes/quick-api';
import { uploadRoutes } from './routes/upload';

export const app = new Hono();

app.use('/api/*', cors({
  origin: ['https://meno.guoyingwei.top', 'https://meno-680.pages.dev', 'http://127.0.0.1:5173', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}));

app.route('/api/public', publicRoutes);
app.route('/api', authRoutes);
app.route('/api', memoRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api', uploadRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/quick', quickApiRoutes);

// Fallback: serve old image URLs at /assets/* (before prefix was changed to /api/assets/*)
app.get('/assets/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await (c.env as { ASSETS: R2Bucket }).ASSETS.get(key);

  if (!object) {
    return c.json({ message: 'Asset not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: import('./db/client').WorkerBindings) {
    const { purgeOldTrash, backupMemosToR2 } = await import('./db/memo-repository');
    const { processMemoImageOcrQueue } = await import('./lib/image-ocr');
    await purgeOldTrash(env.DB, env.ASSETS);
    await backupMemosToR2(env.DB, env.ASSETS);
    await processMemoImageOcrQueue(env);
  },
};
