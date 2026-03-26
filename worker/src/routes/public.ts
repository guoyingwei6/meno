import { Hono } from 'hono';
import { getPublicStats, listPublicDateCounts, getPublicMemoBySlug, listPublicMemos, listPublicTagCounts } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';

export const publicRoutes = new Hono<{ Bindings: WorkerBindings }>();

publicRoutes.get('/memos', async (c) => {
  const tag = c.req.query('tag');
  const date = c.req.query('date');

  return c.json({
    memos: await listPublicMemos(c.env.DB, { tag, date }),
  });
});

publicRoutes.get('/memos/:slug', async (c) => {
  const memo = await getPublicMemoBySlug(c.env.DB, c.req.param('slug'));

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  return c.json({ memo });
});

publicRoutes.get('/tags', async (c) => {
  return c.json({ tags: await listPublicTagCounts(c.env.DB) });
});

publicRoutes.get('/calendar', async (c) => {
  return c.json({ days: await listPublicDateCounts(c.env.DB) });
});

publicRoutes.get('/heatmap', async (c) => {
  return c.json({ cells: await listPublicDateCounts(c.env.DB) });
});

publicRoutes.get('/stats', async (c) => {
  return c.json({ stats: await getPublicStats(c.env.DB) });
});
