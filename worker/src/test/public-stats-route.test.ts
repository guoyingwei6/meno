import { beforeEach, describe, expect, it } from 'vitest';
import { applySchema } from '../db/schema';
import { createMemo } from '../db/memo-repository';
import { createTestD1 } from './d1-test-helpers';
import { app } from '../index';

describe('GET /api/public/stats', () => {
  let env: {
    DB: D1Database;
    ASSETS: R2Bucket;
    APP_ORIGIN: string;
    ASSET_PUBLIC_BASE_URL: string;
    GITHUB_ALLOWED_LOGIN: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    SESSION_SECRET: string;
  };

  beforeEach(async () => {
    const db = createTestD1();
    applySchema(db);
    await createMemo(db, {
      slug: 'p1',
      content: '公开内容 #平台/小红书',
      visibility: 'public',
      displayDate: '2026-03-25',
    });
    await createMemo(db, {
      slug: 'p2',
      content: '私密内容 #类别/知识储备',
      visibility: 'private',
      displayDate: '2026-03-24',
    });

    env = {
      DB: db,
      ASSETS: {} as R2Bucket,
      APP_ORIGIN: 'http://localhost:5173',
      ASSET_PUBLIC_BASE_URL: 'https://assets.meno.local',
      GITHUB_ALLOWED_LOGIN: 'guoyingwei',
      GITHUB_CLIENT_ID: 'github-client-id',
      GITHUB_CLIENT_SECRET: 'github-client-secret',
      SESSION_SECRET: 'test-secret',
    };
  });

  it('returns only public counts and streak for visitor sidebar', async () => {
    const response = await app.request('http://localhost/api/public/stats', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      stats: {
        total: 1,
        tags: 1,
        streakDays: 1,
      },
    });
  });
});
