import { describe, expect, it, vi } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';
import type { WorkerBindings } from '../db/client';

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

  it('triggers immediate async transcription for newly created voice notes', async () => {
    const env = await createTestEnv();
    (env as WorkerBindings).AI = {
      ...(env as WorkerBindings).AI,
      run: vi.fn(async (model: string) => {
        if (model === '@cf/openai/whisper-large-v3-turbo') {
          return { text: '立即触发的异步转写' };
        }
        return { data: [[1, 2, 3]] };
      }),
    };
    await env.ASSETS.put('voice-notes/immediate.m4a', new Uint8Array([1, 2, 3]).buffer);

    const scheduledTasks: Promise<unknown>[] = [];
    const waitUntil = vi.fn((task: Promise<unknown>) => {
      scheduledTasks.push(task);
    });
    const response = await app.fetch(new Request('http://localhost/api/memos', {
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
          objectKey: 'voice-notes/immediate.m4a',
          audioUrl: 'https://cdn.example.com/voice-notes/immediate.m4a',
          mimeType: 'audio/mp4',
          durationMs: 2400,
        },
      }),
    }), env, {
      waitUntil,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext);

    expect(response.status).toBe(201);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(scheduledTasks);

    const payload = (await response.json()) as { memo: MemoDetail };
    const readResponse = await app.request(
      `http://localhost/api/dashboard/memos/${payload.memo.slug}`,
      {
        headers: {
          Cookie: 'meno_session=valid-author-session',
        },
      },
      env,
    );

    const readPayload = (await readResponse.json()) as { memo: MemoDetail };
    expect(readPayload.memo.content).toBe('立即触发的异步转写');
    expect(readPayload.memo.voiceNote).toEqual(expect.objectContaining({
      transcriptStatus: 'done',
      transcriptText: '立即触发的异步转写',
    }));
  });
});
