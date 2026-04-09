import { describe, expect, it } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('POST /api/memos', () => {

  it('rejects unauthenticated memo creation', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/memos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Hello #meno',
        visibility: 'private',
        displayDate: '2026-03-24',
      }),
    }, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
  });

  it('creates a private memo for the author session', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/memos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
      },
      body: JSON.stringify({
        content: 'Hello #meno',
        visibility: 'private',
        displayDate: '2026-03-24',
      }),
    }, env);

    expect(response.status).toBe(201);

    const payload = (await response.json()) as { memo: MemoDetail };
    expect(payload.memo).toEqual(
      expect.objectContaining({
        slug: expect.any(String),
        content: 'Hello #meno',
        visibility: 'private',
        displayDate: '2026-03-24',
        tags: ['meno'],
      }),
    );
  });
});
