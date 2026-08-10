import type { MemoSummary, PublicMemosResponse } from '../types/shared';

export const PUBLIC_FEED_CACHE_KEY = 'meno:public-feed:first-page:v1';
export const PUBLIC_FEED_CACHE_VERSION = 1;
export const PUBLIC_FEED_CACHE_TTL_MS = 30_000;
export const PUBLIC_FEED_PAGE_SIZE = 20;

interface PersistedPublicFeedCache {
  version: number;
  cachedAt: number;
  expiresAt: number;
  data: PublicMemosResponse;
}

export interface PublicFeedCacheHit {
  response: PublicMemosResponse;
  cachedAt: number;
}

const getStorage = (): Storage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isPublicMemo = (value: unknown): value is MemoSummary => (
  isRecord(value) && value.visibility === 'public' && value.deletedAt === null
);

const isPublicFirstPage = (value: unknown): value is PublicMemosResponse => {
  if (!isRecord(value) || !Array.isArray(value.memos) || value.memos.length > PUBLIC_FEED_PAGE_SIZE) return false;
  if (value.nextCursor !== undefined && value.nextCursor !== null && typeof value.nextCursor !== 'string') return false;
  return value.memos.every(isPublicMemo);
};

const removeCachedPublicFeed = (storage: Storage) => {
  try {
    storage.removeItem(PUBLIC_FEED_CACHE_KEY);
  } catch {
    // Storage may be present but unavailable (for example in private mode).
  }
};

export const readPublicFeedCache = (now = Date.now()): PublicFeedCacheHit | null => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(PUBLIC_FEED_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedPublicFeedCache>;
    const cachedAt = parsed.cachedAt;
    const expiresAt = parsed.expiresAt;
    if (
      parsed.version !== PUBLIC_FEED_CACHE_VERSION
      || typeof cachedAt !== 'number'
      || !Number.isFinite(cachedAt)
      || typeof expiresAt !== 'number'
      || !Number.isFinite(expiresAt)
      || expiresAt <= now
      || expiresAt - cachedAt > PUBLIC_FEED_CACHE_TTL_MS
      || !isPublicFirstPage(parsed.data)
    ) {
      removeCachedPublicFeed(storage);
      return null;
    }

    return { response: parsed.data, cachedAt };
  } catch {
    removeCachedPublicFeed(storage);
    return null;
  }
};

export const writePublicFeedCache = (response: PublicMemosResponse, now = Date.now()): void => {
  if (!isPublicFirstPage(response)) return;

  const storage = getStorage();
  if (!storage) return;

  const entry: PersistedPublicFeedCache = {
    version: PUBLIC_FEED_CACHE_VERSION,
    cachedAt: now,
    expiresAt: now + PUBLIC_FEED_CACHE_TTL_MS,
    data: {
      memos: response.memos,
      nextCursor: response.nextCursor ?? null,
    },
  };

  try {
    storage.setItem(PUBLIC_FEED_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // A full, disabled, or otherwise unavailable localStorage must be benign.
  }
};
