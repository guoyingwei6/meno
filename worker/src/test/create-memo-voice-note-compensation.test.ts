import { describe, expect, it, vi } from 'vitest';

const { upsertMemoVoiceNoteMock } = vi.hoisted(() => ({
  upsertMemoVoiceNoteMock: vi.fn(),
}));

vi.mock('../db/memo-voice-note-repository', async () => {
  const actual = await vi.importActual<typeof import('../db/memo-voice-note-repository')>('../db/memo-voice-note-repository');
  return {
    ...actual,
    upsertMemoVoiceNote: upsertMemoVoiceNoteMock,
  };
});

import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('POST /api/memos voice note compensation', () => {
  it('removes the memo when voice note persistence fails', async () => {
    upsertMemoVoiceNoteMock.mockRejectedValueOnce(new Error('voice note write failed'));

    const env = await createTestEnv();
    const response = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
        },
        body: JSON.stringify({
          content: 'Compensation memo #audio-fail',
          visibility: 'private',
          displayDate: '2026-04-13',
          voiceNote: {
            objectKey: 'voice-notes/failed.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/failed.m4a',
            mimeType: 'audio/mp4',
            durationMs: 1_000,
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(500);

    const memoRow = await env.DB.prepare('SELECT id FROM memos WHERE content = ? LIMIT 1')
      .bind('Compensation memo #audio-fail')
      .first<{ id: number }>();
    expect(memoRow).toBeNull();

    const orphanTags = await env.DB.prepare('SELECT COUNT(*) as count FROM memo_tags WHERE memo_id NOT IN (SELECT id FROM memos)')
      .first<{ count: number }>();
    expect(orphanTags?.count).toBe(0);
  });
});
