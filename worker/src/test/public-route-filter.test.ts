import { describe, expect, it } from 'vitest';
import type { PublicMemosResponse } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('GET /api/public/memos with tag filter', () => {
  it('returns only memos matching the tag query', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/memos?tag=cloudflare', {}, env);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as PublicMemosResponse;

    expect(payload.memos).toHaveLength(1);
    expect(payload.memos[0].slug).toBe('public-memo-1');
    expect(payload.memos[0].tags).toContain('cloudflare');
  });
});
