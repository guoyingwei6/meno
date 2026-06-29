import { Hono } from 'hono';
import { getPublicStats, getRecordStats, listPublicDateCounts, getPublicMemoBySlug, listPublicMemos, listPublicTagCounts, searchPublicMemos } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';

export const publicRoutes = new Hono<{ Bindings: WorkerBindings }>();

const parsePagination = (limitParam?: string, cursorParam?: string) => {
  const rawLimit = Number(limitParam);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    return {};
  }
  const limit = Math.min(Math.floor(rawLimit), 100);
  const cursor = String(Math.max(0, Number(cursorParam ?? 0) || 0));
  return { limit, cursor };
};

const buildPagedResponse = <T>(items: T[], limit?: number, cursor?: string) => {
  if (!limit) return { memos: items };
  const hasMore = items.length > limit;
  const memos = hasMore ? items.slice(0, limit) : items;
  const offset = Math.max(0, Number(cursor ?? 0) || 0);
  return {
    memos,
    nextCursor: hasMore ? String(offset + limit) : null,
  };
};

publicRoutes.get('/memos', async (c) => {
  const tag = c.req.query('tag');
  const date = c.req.query('date');
  const pagination = parsePagination(c.req.query('limit'), c.req.query('cursor'));
  const fetchLimit = pagination.limit ? pagination.limit + 1 : undefined;
  const memos = await listPublicMemos(c.env.DB, { tag, date, ...pagination, limit: fetchLimit });

  return c.json(buildPagedResponse(memos, pagination.limit, pagination.cursor));
});

publicRoutes.get('/memos/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q) return c.json({ memos: [] });
  return c.json({ memos: await searchPublicMemos(c.env.DB, q) });
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

publicRoutes.get('/record-stats', async (c) => {
  const stats = await getRecordStats(c.env.DB, false);
  return c.json({ ...stats, totalStorageBytes: 0, imageCount: 0 });
});
