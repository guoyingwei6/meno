import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoSummary } from '../../../shared/src/types';
import { app } from '../index';
import { applySchema } from '../db/schema';
import { createMemo } from '../db/memo-repository';
import { createTestD1 } from './d1-test-helpers';

describe('v1 API and OpenAPI document', () => {
  let db: D1Database;
  const env = {
    DB: undefined as unknown as D1Database,
    ASSETS: {} as R2Bucket,
    APP_ORIGIN: 'http://localhost:5173',
    API_ORIGIN: 'http://localhost',
    GITHUB_ALLOWED_LOGIN: 'guoyingwei',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    SESSION_SECRET: 'test-secret',
    API_TOKEN: 'test-api-token',
  };

  const apiHeaders = {
    'Content-Type': 'application/json',
    'X-API-Key': env.API_TOKEN,
  };

  beforeEach(async () => {
    db = createTestD1();
    applySchema(db);
    env.DB = db;

    await createMemo(db, {
      slug: 'v1-public',
      content: 'Public v1 memo #api',
      visibility: 'public',
      displayDate: '2026-06-28',
    });

    await createMemo(db, {
      slug: 'v1-private',
      content: 'Private v1 memo #secret',
      visibility: 'private',
      displayDate: '2026-06-29',
    });
  });

  it('serves a machine-readable OpenAPI document', async () => {
    const response = await app.request('http://localhost/openapi.json', {}, env);
    const payload = await response.json() as {
      openapi: string;
      paths: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(payload.openapi).toBe('3.1.0');
    expect(payload.paths['/api/v1/memos']).toBeDefined();
    expect(payload.paths['/api/v1/export']).toBeDefined();
  });

  it('requires an API token for v1 memo listing', async () => {
    const response = await app.request('http://localhost/api/v1/memos', {}, env);

    expect(response.status).toBe(401);
  });

  it('lists, creates, updates, trashes, and exports memos through v1', async () => {
    const listResponse = await app.request(
      'http://localhost/api/v1/memos?visibility=all',
      { headers: apiHeaders },
      env,
    );
    const listPayload = await listResponse.json() as { memos: MemoSummary[] };

    expect(listResponse.status).toBe(200);
    expect(listPayload.memos.map((memo) => memo.slug)).toEqual(['v1-private', 'v1-public']);

    const createResponse = await app.request(
      'http://localhost/api/v1/memos',
      {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({
          content: 'Created from v1 #external',
          visibility: 'private',
          displayDate: '2026-06-30',
        }),
      },
      env,
    );
    const createPayload = await createResponse.json() as { memo: MemoSummary };

    expect(createResponse.status).toBe(201);
    expect(createPayload.memo.slug).toMatch(/^\d{8}-[a-z0-9]+$/);
    expect(createPayload.memo.tags).toEqual(['external']);

    const updateResponse = await app.request(
      `http://localhost/api/v1/memos/${createPayload.memo.id}`,
      {
        method: 'PATCH',
        headers: apiHeaders,
        body: JSON.stringify({
          content: 'Updated from v1 #external #updated',
          visibility: 'public',
        }),
      },
      env,
    );
    const updatePayload = await updateResponse.json() as { memo: MemoSummary };

    expect(updateResponse.status).toBe(200);
    expect(updatePayload.memo.visibility).toBe('public');
    expect(updatePayload.memo.tags).toEqual(['external', 'updated']);

    const deleteResponse = await app.request(
      `http://localhost/api/v1/memos/${createPayload.memo.id}`,
      {
        method: 'DELETE',
        headers: apiHeaders,
      },
      env,
    );

    expect(deleteResponse.status).toBe(200);

    const exportResponse = await app.request(
      'http://localhost/api/v1/export',
      { headers: apiHeaders },
      env,
    );
    const exportPayload = await exportResponse.json() as {
      version: number;
      memos: MemoSummary[];
    };

    expect(exportResponse.status).toBe(200);
    expect(exportPayload.version).toBe(1);
    expect(exportPayload.memos.some((memo) => memo.deletedAt !== null)).toBe(true);
  });
});
