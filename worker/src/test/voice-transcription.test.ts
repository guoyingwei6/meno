import { describe, expect, it, vi } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import worker from '../index';
import { app } from '../index';
import { createAsset } from '../db/asset-repository';
import { createMemo } from '../db/memo-repository';
import { getMemoVoiceNoteByMemoId } from '../db/memo-voice-note-repository';
import { createTestEnv } from './route-test-helpers';
import type { WorkerBindings } from '../db/client';

describe('voice note transcription queue', () => {
  it('does not send private audio to Workers AI by default', async () => {
    const env = await createTestEnv();
    const aiRun = vi.fn(async (model: string) => {
      if (model === '@cf/openai/whisper-large-v3-turbo') {
        return { text: '不应发送的私密音频转写' };
      }
      return { data: [[1, 2, 3]] };
    });
    (env as WorkerBindings).AI = {
      ...(env as WorkerBindings).AI,
      run: aiRun,
    };
    await env.ASSETS.put('voice-notes/private.m4a', new Uint8Array([1, 2, 3]).buffer);

    const createResponse = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '',
          visibility: 'private',
          displayDate: '2026-04-14',
          voiceNote: {
            objectKey: 'voice-notes/private.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/private.m4a',
            mimeType: 'audio/mp4',
            durationMs: 3200,
          },
        }),
      },
      env,
    );

    const created = (await createResponse.json()) as { memo: MemoDetail };
    await worker.scheduled({} as ScheduledEvent, env);

    expect(aiRun).not.toHaveBeenCalled();
    await expect(getMemoVoiceNoteByMemoId(env.DB, created.memo.id)).resolves.toEqual(
      expect.objectContaining({
        transcriptStatus: 'pending',
        transcriptAttempts: 0,
        transcriptText: null,
      }),
    );
  });

  it('does not send a shared private audio object to Workers AI through a public memo', async () => {
    const env = await createTestEnv();
    const objectKey = 'voice-notes/model-private-shared.m4a';
    const assetUrl = `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
    const privateOwner = await createMemo(env.DB, {
      slug: 'voice-private-asset-owner',
      content: `Private owner ${assetUrl}`,
      visibility: 'private',
      displayDate: '2026-04-14',
    });
    await env.ASSETS.put(objectKey, new Uint8Array([4, 5, 6]).buffer);
    await createAsset(env.DB, {
      memoId: privateOwner.id,
      objectKey,
      originalUrl: assetUrl,
      mimeType: 'audio/mp4',
      size: 3,
    });
    const aiRun = vi.fn(async (model: string) => (
      model === '@cf/openai/whisper-large-v3-turbo'
        ? { text: '不应发送的共享私密音频' }
        : { data: [[1, 2, 3]] }
    ));
    (env as WorkerBindings).AI = { ...(env as WorkerBindings).AI, run: aiRun };

    const createResponse = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '公开 memo 不能释放同一私密音频',
          visibility: 'public',
          displayDate: '2026-04-14',
          voiceNote: {
            objectKey,
            audioUrl: assetUrl,
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

    expect(aiRun.mock.calls.filter(([model]) => model === '@cf/openai/whisper-large-v3-turbo')).toHaveLength(0);
    await expect(getMemoVoiceNoteByMemoId(env.DB, created.memo.id)).resolves.toEqual(
      expect.objectContaining({ transcriptStatus: 'pending', transcriptAttempts: 0, transcriptText: null }),
    );
  });

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
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '',
          visibility: 'public',
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
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '用户自己写的正文',
          visibility: 'public',
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
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '',
          visibility: 'public',
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
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '',
          visibility: 'public',
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

  it('retries a failed voice note from the queue and completes it on a later attempt', async () => {
    const env = await createTestEnv();
    const transcriptionRun = vi.fn()
      .mockRejectedValueOnce(new Error('temporary Workers AI failure'))
      .mockResolvedValueOnce({ text: '重试后完成的转写' });
    (env as WorkerBindings).AI = {
      ...(env as WorkerBindings).AI,
      run: transcriptionRun,
    };
    await env.ASSETS.put('voice-notes/retry.m4a', new Uint8Array([10, 11]).buffer);

    const createResponse = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '',
          visibility: 'public',
          displayDate: '2026-04-14',
          voiceNote: {
            objectKey: 'voice-notes/retry.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/retry.m4a',
            mimeType: 'audio/mp4',
            durationMs: 1800,
          },
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { memo: MemoDetail };

    await worker.scheduled({} as ScheduledEvent, env);
    const failed = await getMemoVoiceNoteByMemoId(env.DB, created.memo.id);
    expect(failed).toEqual(expect.objectContaining({
      transcriptStatus: 'failed',
      transcriptAttempts: 1,
    }));

    await worker.scheduled({} as ScheduledEvent, env);
    const completed = await getMemoVoiceNoteByMemoId(env.DB, created.memo.id);
    expect(transcriptionRun).toHaveBeenCalledTimes(2);
    expect(completed).toEqual(expect.objectContaining({
      transcriptStatus: 'done',
      transcriptText: '重试后完成的转写',
      transcriptAttempts: 2,
    }));
  });

  it('does not process a failed voice note after the transcription attempt limit', async () => {
    const env = await createTestEnv();
    const transcriptionRun = vi.fn().mockResolvedValue({ text: '不应出现的转写' });
    (env as WorkerBindings).AI = {
      ...(env as WorkerBindings).AI,
      run: transcriptionRun,
    };
    await env.ASSETS.put('voice-notes/exhausted.m4a', new Uint8Array([12, 13]).buffer);

    const createResponse = await app.request(
      'http://localhost/api/memos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: JSON.stringify({
          content: '',
          visibility: 'public',
          displayDate: '2026-04-14',
          voiceNote: {
            objectKey: 'voice-notes/exhausted.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/exhausted.m4a',
            mimeType: 'audio/mp4',
            durationMs: 1800,
          },
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { memo: MemoDetail };

    await env.DB
      .prepare(
        `UPDATE memo_voice_notes
         SET transcript_status = ?, transcript_attempts = ?, transcript_error = ?, updated_at = ?
         WHERE memo_id = ?`,
      )
      .bind('failed', 5, 'permanent Workers AI failure', new Date().toISOString(), created.memo.id)
      .run();

    await worker.scheduled({} as ScheduledEvent, env);

    expect(transcriptionRun).not.toHaveBeenCalled();
    const exhausted = await getMemoVoiceNoteByMemoId(env.DB, created.memo.id);
    expect(exhausted).toEqual(expect.objectContaining({
      transcriptStatus: 'failed',
      transcriptAttempts: 5,
      transcriptError: 'permanent Workers AI failure',
    }));
  });
});
