import { describe, expect, it } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('POST /api/memos with voice note', () => {
  it('persists a voice note and returns it on create and read responses', async () => {
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
          content: 'Voice note memo #audio',
          visibility: 'private',
          displayDate: '2026-04-13',
          voiceNote: {
            objectKey: 'voice-notes/voice-note-memo-1.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/voice-note-memo-1.m4a',
            mimeType: 'audio/mp4',
            durationMs: 12_345,
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(201);

    const payload = (await response.json()) as { memo: MemoDetail };
    expect(payload.memo).toEqual(
      expect.objectContaining({
        content: 'Voice note memo #audio',
        visibility: 'private',
        tags: ['audio'],
        voiceNote: expect.objectContaining({
          objectKey: 'voice-notes/voice-note-memo-1.m4a',
          audioUrl: 'https://cdn.example.com/voice-notes/voice-note-memo-1.m4a',
          mimeType: 'audio/mp4',
          durationMs: 12_345,
          transcriptStatus: 'pending',
          transcriptText: null,
          transcriptAttempts: 0,
        }),
      }),
    );

    const storedVoiceNote = await env.DB.prepare('SELECT * FROM memo_voice_notes WHERE memo_id = ? LIMIT 1')
      .bind(payload.memo.id)
      .first<Record<string, unknown>>();

    expect(storedVoiceNote).toEqual(
      expect.objectContaining({
        object_key: 'voice-notes/voice-note-memo-1.m4a',
        audio_url: 'https://cdn.example.com/voice-notes/voice-note-memo-1.m4a',
        mime_type: 'audio/mp4',
        duration_ms: 12_345,
        transcript_status: 'pending',
      }),
    );

    const readResponse = await app.request(
      `http://localhost/api/dashboard/memos/${payload.memo.slug}`,
      {
        headers: {
          Cookie: 'meno_session=valid-author-session',
        },
      },
      env,
    );

    expect(readResponse.status).toBe(200);

    const readPayload = (await readResponse.json()) as { memo: MemoDetail };
    expect(readPayload.memo.voiceNote).toEqual(
      expect.objectContaining({
        objectKey: 'voice-notes/voice-note-memo-1.m4a',
        transcriptStatus: 'pending',
      }),
    );
  });

  it('persists browser-native transcript fields when provided', async () => {
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
          content: '这是浏览器原生转写',
          visibility: 'private',
          displayDate: '2026-04-14',
          voiceNote: {
            objectKey: 'voice-notes/native-transcript.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/native-transcript.m4a',
            mimeType: 'audio/mp4',
            durationMs: 3456,
            transcriptText: '这是浏览器原生转写',
            transcriptSource: 'browser-native',
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(201);

    const payload = (await response.json()) as { memo: MemoDetail };
    expect(payload.memo.voiceNote).toEqual(
      expect.objectContaining({
        transcriptStatus: 'done',
        transcriptText: '这是浏览器原生转写',
        transcriptSource: 'browser-native',
      }),
    );
  });
});
