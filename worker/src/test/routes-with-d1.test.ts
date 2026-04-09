import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoSummary, PublicMemosResponse } from '../../../shared/src/types';
import { app } from '../index';
import { createMemo } from '../db/memo-repository';
import { applySchema } from '../db/schema';
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
});
