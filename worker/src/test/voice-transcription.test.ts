import { describe, expect, it } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import worker from '../index';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('voice note transcription queue', () => {
  it('marks pending voice notes as not_available when no transcription engine is configured', async () => {
    const env = await createTestEnv();

    const createResponse = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
        },
        body: JSON.stringify({
          content: '',
          visibility: 'private',
          displayDate: '2026-04-14',
          voiceNote: {
            objectKey: 'voice-notes/queued.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/queued.m4a',
            mimeType: 'audio/mp4',
            durationMs: 3200,
          },
        }),
      },
      env,
    );

    expect(createResponse.status).toBe(201);

    const created = (await createResponse.json()) as { memo: MemoDetail };
    expect(created.memo.voiceNote?.transcriptStatus).toBe('pending');

    await worker.scheduled({} as ScheduledEvent, env);

    const readResponse = await app.request(
      `http://localhost/api/dashboard/memos/${created.memo.slug}`,
      {
        headers: {
          Cookie: 'meno_session=valid-author-session',
        },
      },
      env,
    );

    const readPayload = (await readResponse.json()) as { memo: MemoDetail };
    expect(readPayload.memo.voiceNote?.transcriptStatus).toBe('not_available');
    expect(readPayload.memo.voiceNote?.transcriptError).toBe('No transcription engine configured');
  });
});
