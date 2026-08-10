import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoSummary, PublicMemosResponse } from '../types/shared';
import {
  PUBLIC_FEED_CACHE_KEY,
  PUBLIC_FEED_CACHE_TTL_MS,
  PUBLIC_FEED_CACHE_VERSION,
  readPublicFeedCache,
  writePublicFeedCache,
} from '../lib/public-feed-cache';

const publicMemo: MemoSummary = {
  id: 1,
  slug: 'public-memo',
  content: 'Public memo',
  excerpt: 'Public memo',
  visibility: 'public',
  displayDate: '2026-08-10',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  publishedAt: '2026-08-10T00:00:00.000Z',
  deletedAt: null,
  pinnedAt: null,
  favoritedAt: null,
  previousVisibility: null,
  hasImages: false,
  imageCount: 0,
  tagCount: 0,
  tags: [],
};

const publicPage: PublicMemosResponse = {
  memos: [publicMemo],
  nextCursor: 'next-page',
};

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('public feed persistence cache', () => {
  it('stores only a versioned, short-lived public first page', () => {
    writePublicFeedCache(publicPage, 1_000);

    const stored = JSON.parse(localStorage.getItem(PUBLIC_FEED_CACHE_KEY) ?? '{}') as {
      version?: number;
      cachedAt?: number;
      expiresAt?: number;
      data?: PublicMemosResponse;
    };

    expect(stored.version).toBe(PUBLIC_FEED_CACHE_VERSION);
    expect(stored.cachedAt).toBe(1_000);
    expect(stored.expiresAt).toBe(1_000 + PUBLIC_FEED_CACHE_TTL_MS);
    expect(stored.data).toEqual(publicPage);
    expect(stored).not.toHaveProperty('authenticated');
    expect(stored).not.toHaveProperty('role');
    expect(stored).not.toHaveProperty('githubLogin');
  });

  it('rejects private or oversized pages instead of persisting them', () => {
    writePublicFeedCache({
      memos: [{ ...publicMemo, visibility: 'private' }],
      nextCursor: null,
    });
    expect(localStorage.getItem(PUBLIC_FEED_CACHE_KEY)).toBeNull();

    writePublicFeedCache({
      memos: Array.from({ length: 21 }, (_, index) => ({ ...publicMemo, id: index + 1 })),
      nextCursor: null,
    });
    expect(localStorage.getItem(PUBLIC_FEED_CACHE_KEY)).toBeNull();
  });

  it('returns a valid entry and removes expired or unknown versions', () => {
    writePublicFeedCache(publicPage, 1_000);
    expect(readPublicFeedCache(1_000 + PUBLIC_FEED_CACHE_TTL_MS - 1)).toEqual({
      response: publicPage,
      cachedAt: 1_000,
    });

    expect(readPublicFeedCache(1_000 + PUBLIC_FEED_CACHE_TTL_MS)).toBeNull();
    expect(localStorage.getItem(PUBLIC_FEED_CACHE_KEY)).toBeNull();

    localStorage.setItem(PUBLIC_FEED_CACHE_KEY, JSON.stringify({
      version: PUBLIC_FEED_CACHE_VERSION + 1,
      cachedAt: 1_000,
      expiresAt: 2_000,
      data: publicPage,
    }));
    expect(readPublicFeedCache(1_001)).toBeNull();
    expect(localStorage.getItem(PUBLIC_FEED_CACHE_KEY)).toBeNull();
  });

  it('silently skips cache operations when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage disabled'); },
      setItem: () => { throw new Error('storage disabled'); },
      removeItem: () => { throw new Error('storage disabled'); },
    });

    expect(() => writePublicFeedCache(publicPage)).not.toThrow();
    expect(() => readPublicFeedCache()).not.toThrow();
    expect(readPublicFeedCache()).toBeNull();
  });
});
