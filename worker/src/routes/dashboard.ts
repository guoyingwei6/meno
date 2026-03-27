import { Hono } from 'hono';
import { getAuthorMemoBySlug, getDashboardStats, getRecordStats, listAuthorDateCounts, listAuthorMemos, listAuthorTagCounts } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { isAuthorSession } from '../lib/auth';
import { parseTags } from '../lib/tag-parser';

export const dashboardRoutes = new Hono<{ Bindings: WorkerBindings }>();

dashboardRoutes.use('*', async (c, next) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  await next();
});

dashboardRoutes.get('/stats', async (c) => {
  return c.json({ stats: await getDashboardStats(c.env.DB) });
});

dashboardRoutes.get('/record-stats', async (c) => {
  return c.json(await getRecordStats(c.env.DB, true));
});

dashboardRoutes.get('/memos', async (c) => {
  const view = (c.req.query('view') ?? 'all') as 'all' | 'public' | 'private' | 'draft' | 'trash';
  const date = c.req.query('date');
  return c.json({ memos: await listAuthorMemos(c.env.DB, { view, date }) });
});

dashboardRoutes.get('/tags', async (c) => {
  return c.json({ tags: await listAuthorTagCounts(c.env.DB) });
});

dashboardRoutes.get('/calendar', async (c) => {
  return c.json({ days: await listAuthorDateCounts(c.env.DB) });
});

dashboardRoutes.post('/retag', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, content FROM memos').all();
  let updated = 0;

  for (const row of results ?? []) {
    const id = Number((row as Record<string, unknown>).id);
    const content = String((row as Record<string, unknown>).content);
    const tags = parseTags(content);

    await c.env.DB.prepare('DELETE FROM memo_tags WHERE memo_id = ?').bind(id).run();
    for (const tag of tags) {
      await c.env.DB.prepare('INSERT INTO memo_tags (memo_id, tag) VALUES (?, ?)').bind(id, tag).run();
    }
    const imgMatches = content.match(/!\[.*?\]\(.*?\)/g) || [];
    await c.env.DB.prepare('UPDATE memos SET tag_count = ?, has_images = ?, image_count = ? WHERE id = ?').bind(tags.length, imgMatches.length > 0 ? 1 : 0, imgMatches.length, id).run();
    updated++;
  }

  return c.json({ updated });
});

dashboardRoutes.get('/memos/:slug', async (c) => {
  const memo = await getAuthorMemoBySlug(c.env.DB, c.req.param('slug'));

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  return c.json({ memo });
});
