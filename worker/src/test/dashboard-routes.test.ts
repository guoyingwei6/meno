import { describe, expect, it } from 'vitest';
import type { MemoSummary } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('dashboard routes', () => {

  it('returns author stats for a valid session', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/dashboard/stats', {
      headers: {
        Cookie: 'meno_session=valid-author-session',
      },
    }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      stats: {
        total: 3,
        public: 2,
        private: 1,
        trash: 0,
        tags: 3,
        streakDays: expect.any(Number),
      },
    });
  });

  it('returns all visible author memos for the selected view', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/dashboard/memos?view=private', {
      headers: {
        Cookie: 'meno_session=valid-author-session',
      },
    }, env);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { memos: MemoSummary[] };
    expect(payload.memos).toHaveLength(1);
    expect(payload.memos[0].visibility).toBe('private');
  });

  it('returns a bounded memo page and next cursor for author views', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/dashboard/memos?view=all&limit=2', {
      headers: {
        Cookie: 'meno_session=valid-author-session',
      },
    }, env);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { memos: MemoSummary[]; nextCursor: string | null };
    expect(payload.memos).toHaveLength(2);
    expect(payload.nextCursor).toBe('2');
  });
});
