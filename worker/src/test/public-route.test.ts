import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoSummary, PublicMemosResponse } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';
import { createMemo, decodeMemoCursor } from '../db/memo-repository';

describe('GET /api/public/memos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns public memos sorted by display date then created time', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/memos', {}, env);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as PublicMemosResponse;

    expect(payload.memos).toHaveLength(2);
    expect(payload.memos.map((memo) => memo.slug)).toEqual(['public-memo-1', 'public-memo-2']);
    expect(payload.memos[0].tags).toEqual(['cloudflare', 'meno']);
    expect(payload.memos[1].tags).toEqual(['serverless']);
  });

  it('returns a bounded page and next cursor when limit is provided', async () => {
    const env = await createTestEnv();
    const firstPage = await app.request('http://localhost/api/public/memos?limit=1', {}, env);

    expect(firstPage.status).toBe(200);
    const firstPayload = (await firstPage.json()) as PublicMemosResponse & { nextCursor: string | null };
    expect(firstPayload.memos.map((memo) => memo.slug)).toEqual(['public-memo-1']);
    expect(firstPayload.nextCursor).toEqual(expect.any(String));
    expect(decodeMemoCursor(firstPayload.nextCursor ?? undefined)).toEqual(expect.objectContaining({ id: firstPayload.memos[0].id }));

    const secondPage = await app.request(`http://localhost/api/public/memos?limit=1&cursor=${firstPayload.nextCursor}`, {}, env);
    const secondPayload = (await secondPage.json()) as PublicMemosResponse & { nextCursor: string | null };
    expect(secondPayload.memos.map((memo) => memo.slug)).toEqual(['public-memo-2']);
    expect(secondPayload.nextCursor).toBeNull();
  });

  it('returns a compact public-feed summary while preserving image previews and a detail affordance', async () => {
    const env = await createTestEnv();
    const imageUrl = 'https://api.meno.guoyingwei.top/api/assets/uploads/summary-image.png';
    const fullContent = `${'公开首屏摘要内容。'.repeat(80)}\n![](${imageUrl})\n只应在详情页返回的尾部正文`;
    await createMemo(env.DB, {
      slug: 'public-feed-summary',
      content: fullContent,
      visibility: 'public',
      displayDate: '2099-01-01',
    });

    const response = await app.request('http://localhost/api/public/memos?limit=20', {}, env);
    const payload = await response.json() as PublicMemosResponse;
    const memo = payload.memos.find((item) => item.slug === 'public-feed-summary');

    expect(memo).toMatchObject({
      contentTruncated: true,
      contentCharacterCount: expect.any(Number),
    });
    expect(memo?.content).toContain('…');
    expect(memo?.content).toContain(imageUrl);
    expect(memo?.content).not.toContain('只应在详情页返回的尾部正文');
    expect(memo?.contentCharacterCount).toBeGreaterThan(Array.from(memo?.content ?? '').length);

    const detailResponse = await app.request('http://localhost/api/public/memos/public-feed-summary', {}, env);
    const detailPayload = await detailResponse.json() as { memo: MemoSummary };
    expect(detailResponse.status).toBe(200);
    expect(detailPayload.memo.content).toBe(fullContent);
  });

  it('returns a short public cache validator without bypassing CORS context', async () => {
    const env = await createTestEnv();
    const firstPage = await app.request('http://localhost/api/public/memos', {
      headers: { Origin: 'https://meno.guoyingwei.top' },
    }, env);
    const etag = firstPage.headers.get('ETag');

    expect(firstPage.status).toBe(200);
    expect(firstPage.headers.get('Cache-Control')).toContain('s-maxage=15');
    expect(firstPage.headers.get('Access-Control-Allow-Origin')).toBe('https://meno.guoyingwei.top');
    expect(etag).toEqual(expect.any(String));

    const cached = await app.request('http://localhost/api/public/memos', {
      headers: {
        Origin: 'https://meno.guoyingwei.top',
        'If-None-Match': etag ?? '',
      },
    }, env);
    expect(cached.status).toBe(304);
    expect(cached.headers.get('Access-Control-Allow-Origin')).toBe('https://meno.guoyingwei.top');

    const weakValidator = await app.request('http://localhost/api/public/memos', {
      headers: {
        Origin: 'https://meno.guoyingwei.top',
        'If-None-Match': `W/${etag}`,
      },
    }, env);
    expect(weakValidator.status).toBe(304);
  });

  it('serves a repeated public feed from the Cache API without querying D1 again', async () => {
    const stored = new Map<string, Response>();
    const cacheKey = (request: RequestInfo | URL) => request instanceof Request
      ? request.url
      : request.toString();
    const cache = {
      match: vi.fn(async (request: RequestInfo | URL) => stored.get(cacheKey(request))?.clone()),
      put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
        stored.set(cacheKey(request), response.clone());
      }),
      delete: vi.fn(async () => false),
    };
    vi.stubGlobal('caches', { default: cache });

    const env = await createTestEnv();
    let prepareCalls = 0;
    const observedDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === 'prepare') {
          return (sql: string) => {
            prepareCalls += 1;
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const observedEnv = { ...env, DB: observedDb as D1Database };
    const scheduled: Promise<unknown>[] = [];
    const executionCtx = {
      waitUntil(task: Promise<unknown>) {
        scheduled.push(task);
      },
      passThroughOnException: vi.fn(),
      props: undefined,
    } as unknown as ExecutionContext;

    const first = await app.request('http://localhost/api/public/memos?limit=20', {}, observedEnv, executionCtx);
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Meno-Cache')).toBe('MISS');
    expect(prepareCalls).toBeGreaterThan(0);
    await Promise.all(scheduled);

    prepareCalls = 0;
    const second = await app.request('http://localhost/api/public/memos?limit=20', {}, observedEnv, executionCtx);
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Meno-Cache')).toBe('HIT');
    expect(prepareCalls).toBe(0);
    expect(await second.json()).toEqual(await first.json());
  });

  it('applies image/tag filters and keeps a sort-specific cursor stable', async () => {
    const env = await createTestEnv();
    await createMemo(env.DB, {
      slug: 'public-plain-filter',
      content: '没有标签或图片',
      visibility: 'public',
      displayDate: '2023-01-01',
    });
    await createMemo(env.DB, {
      slug: 'public-image-filter',
      content: '带图 #父级/子级\n![](https://api.meno.guoyingwei.top/api/assets/uploads/filter.png)',
      visibility: 'public',
      displayDate: '2023-01-02',
    });

    const imageResponse = await app.request('http://localhost/api/public/memos?has_images=true', {}, env);
    const imagePayload = await imageResponse.json() as PublicMemosResponse;
    expect(imagePayload.memos.map((memo) => memo.slug)).toContain('public-image-filter');
    expect(imagePayload.memos.every((memo) => memo.hasImages)).toBe(true);

    const noTagsResponse = await app.request('http://localhost/api/public/memos?has_tags=false', {}, env);
    const noTagsPayload = await noTagsResponse.json() as PublicMemosResponse;
    expect(noTagsPayload.memos.map((memo) => memo.slug)).toContain('public-plain-filter');
    expect(noTagsPayload.memos.every((memo) => memo.tags.length === 0)).toBe(true);

    const parentTagResponse = await app.request('http://localhost/api/public/memos?tag=%E7%88%B6%E7%BA%A7', {}, env);
    const parentTagPayload = await parentTagResponse.json() as PublicMemosResponse;
    expect(parentTagPayload.memos.map((memo) => memo.slug)).toContain('public-image-filter');

    const firstPage = await app.request('http://localhost/api/public/memos?limit=1&sort=display-asc', {}, env);
    const firstPayload = await firstPage.json() as PublicMemosResponse & { nextCursor: string | null };
    const cursor = firstPayload.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    expect(decodeMemoCursor(cursor ?? undefined)).toMatchObject({ sort: 'display-asc' });

    const secondPage = await app.request(`http://localhost/api/public/memos?limit=1&sort=display-asc&cursor=${encodeURIComponent(cursor ?? '')}`, {}, env);
    const secondPayload = await secondPage.json() as PublicMemosResponse;
    expect(secondPayload.memos[0]?.id).not.toBe(firstPayload.memos[0]?.id);

    const mismatchedCursor = await app.request(`http://localhost/api/public/memos?limit=1&sort=created-desc&cursor=${encodeURIComponent(cursor ?? '')}`, {}, env);
    expect(mismatchedCursor.status).toBe(400);
  });
});
