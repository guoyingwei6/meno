import { Hono } from 'hono';
import { DEFAULT_MEMO_SORT, decodeMemoCursor, deleteTag, encodeMemoCursor, getAuthorMemoBySlug, getDashboardStats, getRecordStats, isMemoSort, listAuthorDateCounts, listAuthorMemos, listAuthorTagCounts, renameTag, searchAuthorMemos, type MemoSort } from '../db/memo-repository';
import { createMemoShare, revokeMemoShare } from '../db/share-repository';
import { getAppSettings, updateAppSettings } from '../db/settings-repository';
import type { WorkerBindings } from '../db/client';
import { resolveAuthorSession } from '../lib/auth';
import { parseTags } from '../lib/tag-parser';

export const dashboardRoutes = new Hono<{ Bindings: WorkerBindings }>();

const parsePagination = (limitParam?: string, cursorParam?: string): { limit?: number; cursor?: string } => {
  const rawLimit = Number(limitParam);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    return {};
  }
  const limit = Math.min(Math.floor(rawLimit), 100);
  const cursor = cursorParam?.trim() || undefined;
  return { limit, ...(cursor ? { cursor } : {}) };
};

const parseBooleanFilter = (value: string | undefined): boolean | undefined | null => {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
};

const buildPagedResponse = <T extends { pinnedAt: string | null; displayDate: string; createdAt: string; updatedAt: string; id: number }>(items: T[], limit?: number, sort: MemoSort = DEFAULT_MEMO_SORT) => {
  if (!limit) return { memos: items };
  const hasMore = items.length > limit;
  const memos = hasMore ? items.slice(0, limit) : items;
  return {
    memos,
    nextCursor: hasMore && memos.length > 0 ? encodeMemoCursor(memos[memos.length - 1], sort) : null,
  };
};

dashboardRoutes.use('*', async (c, next) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  c.header('Cache-Control', 'private, no-store');
  await next();
});

dashboardRoutes.get('/stats', async (c) => {
  return c.json({ stats: await getDashboardStats(c.env.DB) });
});

dashboardRoutes.get('/record-stats', async (c) => {
  const stats = await getRecordStats(c.env.DB, true);

  let totalStorageBytes = 0;
  let imageCount = 0;
  let cursor: string | undefined;
  do {
    const list = await c.env.ASSETS.list({ limit: 1000, cursor });
    for (const obj of list.objects) {
      totalStorageBytes += obj.size;
      imageCount++;
    }
    cursor = list.truncated ? (list as { cursor?: string }).cursor : undefined;
  } while (cursor);

  return c.json({ ...stats, totalStorageBytes, imageCount });
});

dashboardRoutes.get('/settings', async (c) => {
  return c.json({ settings: await getAppSettings(c.env.DB) });
});

dashboardRoutes.patch('/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  return c.json({ settings: await updateAppSettings(c.env.DB, body) });
});

dashboardRoutes.get('/memos/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q) return c.json({ memos: [] });
  return c.json({ memos: await searchAuthorMemos(c.env.DB, q) });
});

dashboardRoutes.get('/memos', async (c) => {
  const view = (c.req.query('view') ?? 'all') as 'all' | 'public' | 'private' | 'trash' | 'favorited';
  const date = c.req.query('date');
  const tag = c.req.query('tag');
  const rawSort = c.req.query('sort');
  if (rawSort && !isMemoSort(rawSort)) {
    return c.json({ message: 'Invalid sort' }, 400);
  }
  const sort: MemoSort = rawSort && isMemoSort(rawSort) ? rawSort : DEFAULT_MEMO_SORT;
  const hasImages = parseBooleanFilter(c.req.query('has_images'));
  const hasTags = parseBooleanFilter(c.req.query('has_tags'));
  if (hasImages === null || hasTags === null) {
    return c.json({ message: 'Invalid boolean filter' }, 400);
  }
  const rawCursor = c.req.query('cursor');
  const cursor = rawCursor ? decodeMemoCursor(rawCursor) : null;
  if (rawCursor && (!cursor || cursor.sort !== sort)) {
    return c.json({ message: 'Invalid cursor' }, 400);
  }
  const pagination = parsePagination(c.req.query('limit'), c.req.query('cursor'));
  const fetchLimit = pagination.limit ? pagination.limit + 1 : undefined;
  const memos = await listAuthorMemos(c.env.DB, { view, date, tag, hasImages, hasTags, sort, ...pagination, limit: fetchLimit });
  return c.json(buildPagedResponse(memos, pagination.limit, sort));
});

dashboardRoutes.post('/memos/:id/share', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ message: 'Invalid memo id' }, 400);

  const rawExpiresInHours = c.req.query('expiresInHours');
  let expiresAt: string | null = null;
  if (rawExpiresInHours !== undefined) {
    const expiresInHours = Number(rawExpiresInHours);
    if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > 24 * 365) {
      return c.json({ message: 'Invalid share expiry' }, 400);
    }
    expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  }

  const share = await createMemoShare(c.env.DB, id, expiresAt);
  if (!share) return c.json({ message: 'Memo not found' }, 404);

  return c.json({
    share: {
      ...share,
      url: `${c.env.APP_ORIGIN}/share/${share.token}`,
    },
  });
});

dashboardRoutes.delete('/memos/:id/share', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ message: 'Invalid memo id' }, 400);
  await revokeMemoShare(c.env.DB, id);
  return c.json({ success: true });
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

dashboardRoutes.post('/tags/rename', async (c) => {
  const body = await c.req.json<{ oldTag?: string; newTag?: string }>();
  const oldTag = body.oldTag?.trim();
  const newTag = body.newTag?.trim();

  if (!oldTag || !newTag || oldTag === newTag) {
    return c.json({ message: 'Invalid tag rename request' }, 400);
  }

  const updated = await renameTag(c.env.DB, oldTag, newTag);
  return c.json({ updated });
});

dashboardRoutes.post('/tags/delete', async (c) => {
  const body = await c.req.json<{ tag?: string; deleteNotes?: boolean }>();
  const tag = body.tag?.trim();

  if (!tag || typeof body.deleteNotes !== 'boolean') {
    return c.json({ message: 'Invalid tag delete request' }, 400);
  }

  const deleted = await deleteTag(c.env.DB, tag, body.deleteNotes);
  return c.json({ deleted });
});

dashboardRoutes.get('/memos/:slug', async (c) => {
  const memo = await getAuthorMemoBySlug(c.env.DB, c.req.param('slug'));

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  return c.json({ memo });
});
