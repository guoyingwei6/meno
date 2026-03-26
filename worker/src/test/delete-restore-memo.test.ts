import { describe, expect, it } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('memo trash flow', () => {

  it('moves a memo to trash and restores it for the author', async () => {
    const env = await createTestEnv();
    const deleteResponse = await app.request('http://localhost/api/memos/1', {
      method: 'DELETE',
      headers: {
        Cookie: 'meno_session=valid-author-session',
      },
    }, env);

    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ success: true });

    const publicResponse = await app.request('http://localhost/api/public/memos/public-memo-2', {}, env);
    expect(publicResponse.status).toBe(404);

    const restoreResponse = await app.request('http://localhost/api/memos/1/restore', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
      },
    }, env);

    expect(restoreResponse.status).toBe(200);

    const restoredPayload = (await restoreResponse.json()) as { memo: MemoDetail };
    expect(restoredPayload.memo).toEqual(
      expect.objectContaining({
        id: 1,
        deletedAt: null,
        visibility: 'public',
      }),
    );

    const publicAfterRestore = await app.request('http://localhost/api/public/memos/public-memo-2', {}, env);
    expect(publicAfterRestore.status).toBe(200);
  });
});
