import { describe, expect, it, vi } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import worker from '../index';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';
import type { WorkerBindings } from '../db/client';

describe('voice note transcription queue', () => {
  it('transcribes pending voice notes and backfills empty memo content', async () => {
    const env = await createTestEnv();
    (env as WorkerBindings).AI = {
      ...(env as WorkerBindings).AI,
      run: vi.fn(async (model: string) => {
        if (model === '@cf/openai/whisper-large-v3-turbo') {
          return { text: '这是服务端转写结果 #语音' };
        }
        return { data: [[1, 2, 3]] };
      }),
    };
    await env.ASSETS.put('voice-notes/queued.m4a', new Uint8Array([1, 2, 3, 4]).buffer);

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
    expect(readPayload.memo.content).toBe('这是服务端转写结果 #语音');
    expect(readPayload.memo.tags).toContain('语音');
    expect(readPayload.memo.voiceNote).toEqual(expect.objectContaining({
      transcriptStatus: 'done',
      transcriptText: '这是服务端转写结果 #语音',
      transcriptSource: 'workers-ai',
      transcriptError: null,
    }));
  });

  it('does not overwrite existing memo content when server transcription completes', async () => {
    const env = await createTestEnv();
    (env as WorkerBindings).AI = {
      ...(env as WorkerBindings).AI,
      run: vi.fn(async (model: string) => {
        if (model === '@cf/openai/whisper-large-v3-turbo') {
          return { text: '这是异步补录的转写' };
        }
        return { data: [[1, 2, 3]] };
      }),
    };
    await env.ASSETS.put('voice-notes/filled.m4a', new Uint8Array([5, 6, 7]).buffer);

    const createResponse = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
        },
        body: JSON.stringify({
          content: '用户自己写的正文',
          visibility: 'private',
          displayDate: '2026-04-14',
          voiceNote: {
            objectKey: 'voice-notes/filled.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/filled.m4a',
            mimeType: 'audio/mp4',
            durationMs: 2800,
          },
        }),
      },
      env,
    );

    const created = (await createResponse.json()) as { memo: MemoDetail };

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
    expect(readPayload.memo.content).toBe('用户自己写的正文');
    expect(readPayload.memo.voiceNote).toEqual(expect.objectContaining({
      transcriptStatus: 'done',
      transcriptText: '这是异步补录的转写',
      transcriptSource: 'workers-ai',
    }));
  });

  it('marks pending voice notes as not_available when no transcription engine is configured', async () => {
    const env = await createTestEnv();
    delete (env as Partial<WorkerBindings>).AI;

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
            objectKey: 'voice-notes/no-engine.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/no-engine.m4a',
            mimeType: 'audio/mp4',
            durationMs: 3200,
          },
        }),
      },
      env,
    );

    expect(createResponse.status).toBe(201);

    const created = (await createResponse.json()) as { memo: MemoDetail };

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

  it('marks pending voice notes as failed when transcription throws', async () => {
    const env = await createTestEnv();
    (env as WorkerBindings).AI = {
      ...(env as WorkerBindings).AI,
      run: vi.fn(async (model: string) => {
        if (model === '@cf/openai/whisper-large-v3-turbo') {
          throw new Error('workers ai unavailable');
        }
        return { data: [[1, 2, 3]] };
      }),
    };
    await env.ASSETS.put('voice-notes/fail.m4a', new Uint8Array([8, 9]).buffer);

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
            objectKey: 'voice-notes/fail.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/fail.m4a',
            mimeType: 'audio/mp4',
            durationMs: 1800,
          },
        }),
      },
      env,
    );

    const created = (await createResponse.json()) as { memo: MemoDetail };

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
    expect(readPayload.memo.content).toBe('');
    expect(readPayload.memo.voiceNote).toEqual(expect.objectContaining({
      transcriptStatus: 'failed',
      transcriptError: 'workers ai unavailable',
    }));
  });
});
