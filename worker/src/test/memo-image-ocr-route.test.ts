import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('memo image ocr queue', () => {
  it('enqueues image urls when creating a memo with images', async () => {
    const env = await createTestEnv();

    const response = await app.request('http://localhost/api/memos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
      },
      body: JSON.stringify({
        content: '带图 memo\n![](https://api.meno.guoyingwei.top/api/assets/uploads/test.png)',
        visibility: 'draft',
        displayDate: '2026-03-24',
      }),
    }, env);

    expect(response.status).toBe(201);

    const { results } = await env.DB.prepare('SELECT memo_id, image_url, status FROM memo_image_ocr ORDER BY id ASC').all<{
      memo_id: number;
      image_url: string;
      status: string;
    }>();

    expect(results).toHaveLength(1);
    expect(results?.[0]).toEqual({
      memo_id: expect.any(Number),
      image_url: 'https://api.meno.guoyingwei.top/api/assets/uploads/test.png',
      status: 'pending',
    });
  });
});
