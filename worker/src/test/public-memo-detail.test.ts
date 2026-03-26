import { describe, expect, it } from 'vitest';
import type { PublicMemoResponse } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('GET /api/public/memos/:slug', () => {
  it('returns a public memo detail by slug', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/memos/public-memo-1', {}, env);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as PublicMemoResponse;

    expect(payload.memo).toEqual(
      expect.objectContaining({
        slug: 'public-memo-1',
        visibility: 'public',
        content: 'First public memo #cloudflare #meno',
        tags: ['cloudflare', 'meno'],
      }),
    );
  });

  it('returns 404 for a missing public memo', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/memos/missing-slug', {}, env);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: 'Memo not found' });
  });
});
