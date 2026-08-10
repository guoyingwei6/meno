import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('PATCH /api/memos/:id', () => {
  it('updates memo content and visibility for the author', async () => {
    const env = await createTestEnv();

    const response = await app.request(
      'http://localhost/api/memos/3',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: 'Updated private memo #类别/知识储备',
          visibility: 'public',
          displayDate: '2026-03-26',
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { memo: { visibility: string; displayDate: string; content: string } };
    expect(payload.memo.visibility).toBe('public');
    expect(payload.memo.displayDate).toBe('2026-03-26');
    expect(payload.memo.content).toContain('Updated private memo');
  });

  it('returns 400 and leaves the memo unchanged when an update exceeds the image limit', async () => {
    const env = await createTestEnv();
    const response = await app.request(
      'http://localhost/api/memos/3',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: Array.from({ length: 9 }, (_, index) => `![](https://cdn.example.com/update-${index}.png)`).join('\n'),
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    const row = await env.DB.prepare('SELECT content, image_count FROM memos WHERE id = 3').first<{ content: string; image_count: number }>();
    expect(row).toEqual({ content: 'Private memo #private-note', image_count: 0 });
  });
});
