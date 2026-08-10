import { Hono } from 'hono';
import type { Context } from 'hono';
import type { MemoSummary } from '../../../shared/src/types';
import { DEFAULT_MEMO_SORT, decodeMemoCursor, encodeMemoCursor, getPublicStats, getRecordStats, isMemoSort, listPublicDateCounts, getPublicMemoBySlug, listPublicMemos, listPublicTagCounts, searchPublicMemos, type MemoSort } from '../db/memo-repository';
import { getSharedMemoByToken } from '../db/share-repository';
import { getAppSettings } from '../db/settings-repository';
import type { WorkerBindings } from '../db/client';

export const publicRoutes = new Hono<{ Bindings: WorkerBindings }>();

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

const PUBLIC_FEED_EXCERPT_CHARACTER_LIMIT = 240;
const MARKDOWN_IMAGE_REFERENCE_PATTERN = /!\[[^\]\r\n]*?\]\([^\)\r\n]*\)/g;

const extractMarkdownImageReferences = (content: string): string[] => {
  const seen = new Set<string>();
  return (content.match(MARKDOWN_IMAGE_REFERENCE_PATTERN) ?? []).filter((reference) => {
    if (seen.has(reference)) return false;
    seen.add(reference);
    return true;
  });
};

const toPublicFeedSummary = (memo: MemoSummary): MemoSummary => {
  const contentCharacterCount = Array.from(memo.content).length;
  const contentTruncated = contentCharacterCount > PUBLIC_FEED_EXCERPT_CHARACTER_LIMIT;
  if (!contentTruncated) {
    return { ...memo, contentTruncated, contentCharacterCount };
  }

  const excerpt = memo.excerpt || `${Array.from(memo.content).slice(0, PUBLIC_FEED_EXCERPT_CHARACTER_LIMIT).join('')}…`;
  const excerptImages = new Set(extractMarkdownImageReferences(excerpt));
  const missingImages = extractMarkdownImageReferences(memo.content)
    .filter((reference) => !excerptImages.has(reference));
  const content = missingImages.length > 0
    ? `${excerpt}\n\n${missingImages.join('\n\n')}`
    : excerpt;

  return {
    ...memo,
    content,
    contentTruncated,
    contentCharacterCount,
  };
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

const hashEtag = async (body: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `"${hex}"`;
};

const normalizeEtag = (value: string): string => value.trim().replace(/^W\//i, '');

const matchesIfNoneMatch = (headerValue: string | undefined, etag: string): boolean => {
  if (!headerValue) return false;
  const normalizedEtag = normalizeEtag(etag);
  return headerValue.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === '*' || normalizeEtag(trimmed) === normalizedEtag;
  });
};

const getDefaultCache = (): Cache | null => {
  try {
    return typeof caches === 'undefined' ? null : caches.default;
  } catch {
    return null;
  }
};

const cloneWithCacheStatus = (response: Response, status: 'HIT' | 'MISS'): Response => {
  const headers = new Headers(response.headers);
  headers.set('X-Meno-Cache', status);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const publicJson = async <T>(c: Context<{ Bindings: WorkerBindings }>, payload: T) => {
  const body = JSON.stringify(payload);
  const etag = await hashEtag(body);
  const headers = {
    'Cache-Control': 'public, max-age=0, s-maxage=15',
    ETag: etag,
    Vary: 'Origin',
    'Content-Type': 'application/json; charset=UTF-8',
  };
  if (matchesIfNoneMatch(c.req.header('If-None-Match'), etag)) {
    return c.newResponse(null, 304, headers);
  }
  return c.newResponse(body, 200, headers);
};

const publicFeedJson = async <T>(
  c: Context<{ Bindings: WorkerBindings }>,
  loadPayload: () => Promise<T>,
): Promise<Response> => {
  const cache = getDefaultCache();
  // Use a header-free GET key so CORS is still applied per request by Hono's
  // outer middleware instead of being frozen into the cached representation.
  const cacheKey = new Request(c.req.url, { method: 'GET' });

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const etag = cached.headers.get('ETag');
        const hit = cloneWithCacheStatus(cached, 'HIT');
        if (etag && matchesIfNoneMatch(c.req.header('If-None-Match'), etag)) {
          return new Response(null, { status: 304, headers: hit.headers });
        }
        return hit;
      }
    } catch {
      // Cache availability must never make the public feed unavailable.
    }
  }

  const response = cloneWithCacheStatus(await publicJson(c, await loadPayload()), 'MISS');
  if (cache && response.status === 200) {
    const putTask = cache.put(cacheKey, response.clone()).catch(() => undefined);
    let scheduled = false;
    try {
      c.executionCtx.waitUntil(putTask);
      scheduled = true;
    } catch {
      // app.request() tests and non-Worker runtimes may not expose executionCtx.
    }
    if (!scheduled) await putTask;
  }
  return response;
};

publicRoutes.get('/memos', async (c) => {
  const tag = c.req.query('tag');
  const date = c.req.query('date');
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
  return publicFeedJson(c, async () => {
    const memos = await listPublicMemos(c.env.DB, { tag, date, hasImages, hasTags, sort, ...pagination, limit: fetchLimit });
    return buildPagedResponse(memos.map(toPublicFeedSummary), pagination.limit, sort);
  });
});

publicRoutes.get('/memos/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q) return c.json({ memos: [] });
  return publicJson(c, { memos: await searchPublicMemos(c.env.DB, q) });
});

publicRoutes.get('/shares/:token', async (c) => {
  const token = c.req.param('token');
  const memo = await getSharedMemoByToken(c.env.DB, token);
  if (!memo) {
  return c.json({ message: 'Share not found' }, 404, { 'Cache-Control': 'private, no-store' });
  }
  return c.json({ memo }, 200, { 'Cache-Control': 'private, no-store' });
});

publicRoutes.get('/memos/:slug', async (c) => {
  const memo = await getPublicMemoBySlug(c.env.DB, c.req.param('slug'));

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  // A single memo can change visibility; avoid serving a previously public
  // representation from an edge cache after it becomes private.
  return c.json({ memo }, 200, { 'Cache-Control': 'private, no-store' });
});

publicRoutes.get('/tags', async (c) => {
  return publicJson(c, { tags: await listPublicTagCounts(c.env.DB) });
});

publicRoutes.get('/calendar', async (c) => {
  return publicJson(c, { days: await listPublicDateCounts(c.env.DB) });
});

publicRoutes.get('/heatmap', async (c) => {
  return publicJson(c, { cells: await listPublicDateCounts(c.env.DB) });
});

publicRoutes.get('/stats', async (c) => {
  return publicJson(c, { stats: await getPublicStats(c.env.DB) });
});

publicRoutes.get('/settings', async (c) => {
  const settings = await getAppSettings(c.env.DB);
  return publicJson(c, { settings: { siteTitle: settings.siteTitle } });
});

publicRoutes.get('/record-stats', async (c) => {
  const stats = await getRecordStats(c.env.DB, false);
  return publicJson(c, { ...stats, totalStorageBytes: 0, imageCount: 0 });
});
