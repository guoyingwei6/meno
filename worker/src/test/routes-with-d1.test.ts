import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoSummary, PublicMemosResponse } from '../../../shared/src/types';
import { app } from '../index';
import { createMemo } from '../db/memo-repository';
import { applySchema } from '../db/schema';
import { createSession } from '../db/session-repository';
import { createTestD1 } from './d1-test-helpers';

describe('routes backed by D1', () => {
  let db: D1Database;
  const env = {
    DB: undefined as unknown as D1Database,
    ASSETS: {} as R2Bucket,
    APP_ORIGIN: 'http://localhost:5173',
    GITHUB_ALLOWED_LOGIN: 'guoyingwei',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    SESSION_SECRET: 'test-secret',
  };

  beforeEach(async () => {
    db = createTestD1();
    applySchema(db);
    env.DB = db;

    await createMemo(db, {
      slug: 'db-public-1',
      content: 'Database public #meno',
      visibility: 'public',
      displayDate: '2026-03-25',
    });

    await createMemo(db, {
      slug: 'db-private-1',
      content: 'Database private #secret',
      visibility: 'private',
      displayDate: '2026-03-24',
    });

    await createSession(db, {
      id: 'valid-author-session',
      githubUserId: '42',
      githubLogin: 'guoyingwei',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  it('serves public memos from D1', async () => {
    const response = await app.request('http://localhost/api/public/memos', {}, env);
    const payload = (await response.json()) as PublicMemosResponse;

    expect(response.status).toBe(200);
    expect(payload.memos).toHaveLength(1);
    expect(payload.memos[0].slug).toBe('db-public-1');
  });

  it('creates and lists author memos from D1', async () => {
    const createResponse = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          content: 'Created through route #route',
          visibility: 'private',
          displayDate: '2026-03-26',
        }),
      },
      env,
    );

    expect(createResponse.status).toBe(201);

    const listResponse = await app.request(
      'http://localhost/api/dashboard/memos?view=private',
      {
        headers: {
          Cookie: 'meno_session=valid-author-session',
        },
      },
      env,
    );

    const payload = (await listResponse.json()) as { memos: MemoSummary[] };
    expect(payload.memos.some((memo) => memo.slug)).toBe(true);
    expect(payload.memos.some((memo) => memo.visibility === 'private')).toBe(true);
  });

  it('passes public and author feed filters to the database query', async () => {
    const publicResponse = await app.request(
      'http://localhost/api/public/memos?tag=meno&date=2026-03-25',
      {},
      env,
    );
    const publicPayload = (await publicResponse.json()) as { memos: MemoSummary[] };
    expect(publicResponse.status).toBe(200);
    expect(publicPayload.memos.map((memo) => memo.slug)).toEqual(['db-public-1']);

    const favoriteResponse = await app.request(
      'http://localhost/api/memos/2/favorite',
      {
        method: 'POST',
        headers: {
          Cookie: 'meno_session=valid-author-session',
          Origin: 'http://localhost:5173',
        },
      },
      env,
    );
    expect(favoriteResponse.status).toBe(200);

    const authorResponse = await app.request(
      'http://localhost/api/dashboard/memos?view=favorited&tag=secret&date=2026-03-24',
      { headers: { Cookie: 'meno_session=valid-author-session' } },
      env,
    );
    const authorPayload = (await authorResponse.json()) as { memos: MemoSummary[] };
    expect(authorResponse.status).toBe(200);
    expect(authorPayload.memos.map((memo) => memo.slug)).toEqual(['db-private-1']);
  });
});
