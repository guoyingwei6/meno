import { describe, expect, it } from 'vitest';
import type { PublicMemosResponse } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('GET /api/public/memos', () => {
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
});
