import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('GET /api/dashboard/memos/:slug', () => {
  it('returns private memo detail for authenticated author', async () => {
    const env = await createTestEnv();

    const response = await app.request(
      'http://localhost/api/dashboard/memos/private-memo-1',
      {
        headers: {
          Cookie: 'meno_session=valid-author-session',
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { memo: { slug: string; visibility: string } };
    expect(payload.memo.slug).toBe('private-memo-1');
    expect(payload.memo.visibility).toBe('private');
  });
});
