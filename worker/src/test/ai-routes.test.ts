import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeChatResponse, KnowledgeIndexResponse, OcrQueueRunResponse, OcrQueueStatus } from '../../../shared/src/types';
import { app } from '../index';
import { createMemo } from '../db/memo-repository';
import { syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { createTestEnv } from './route-test-helpers';

describe('AI knowledge routes', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: '这是基于笔记库生成的回答。' } }],
      }), {
        headers: { 'Content-Type': 'application/json' },
      })),
    );
  });

  it('indexes non-trashed memos for author session', async () => {
    const env = await createTestEnv();

    const response = await app.request('http://localhost/api/ai/index', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
      },
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as KnowledgeIndexResponse;
    expect(payload.indexed).toBe(2);
  });

  it('rejects unauthenticated chat access', async () => {
    const env = await createTestEnv();

    const response = await app.request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '总结一下',
        config: { url: 'https://models.inference.ai.azure.com', apiKey: 'test', model: 'gpt-4o-mini' },
      }),
    }, env);

    expect(response.status).toBe(401);
  });

  it('returns answer with retrieved memo sources', async () => {
    const env = await createTestEnv();

    await app.request('http://localhost/api/ai/index', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session' },
    }, env);

    const response = await app.request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
      },
      body: JSON.stringify({
        question: 'public memo 说了什么？',
        config: { url: 'https://models.inference.ai.azure.com', apiKey: 'test', model: 'gpt-4o-mini' },
      }),
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as KnowledgeChatResponse;
    expect(payload.answer).toBe('这是基于笔记库生成的回答。');
    expect(payload.sources.length).toBeGreaterThan(0);
    expect(payload.sources.some((source) => source.slug === 'public-memo-1')).toBe(true);
  });

  it('returns OCR queue status for author session', async () => {
    const env = await createTestEnv();
    const memo = await createMemo(env.DB, {
      slug: 'ocr-memo',
      content: '![img](https://example.com/test.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });
    await syncMemoImageOcrTasks(env.DB, memo.id, memo.content, memo.visibility);

    const response = await app.request('http://localhost/api/ai/ocr/status', {
      headers: { Cookie: 'meno_session=valid-author-session' },
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as OcrQueueStatus;
    expect(payload.pending).toBe(1);
    expect(payload.dailyLimit).toBe(20);
    expect(payload.batchSize).toBe(5);
  });

  it('runs one OCR batch and returns refreshed queue status', async () => {
    const env = await createTestEnv();
    const memo = await createMemo(env.DB, {
      slug: 'ocr-run-memo',
      content: '![img](https://example.com/test.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });
    await syncMemoImageOcrTasks(env.DB, memo.id, memo.content, memo.visibility);

    const response = await app.request('http://localhost/api/ai/ocr/run', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session' },
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as OcrQueueRunResponse;
    expect(payload.processed).toBe(1);
    expect(payload.status.done).toBe(1);
    expect(payload.status.pending).toBe(0);
  });

  it('seeds only a small batch of historical image memos when queue is empty', async () => {
    const env = await createTestEnv();
    env.OCR_SEED_BATCH_SIZE = '2';
    env.OCR_BATCH_SIZE = '1';

    await createMemo(env.DB, {
      slug: 'ocr-seed-1',
      content: '![img](https://example.com/1.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });
    await createMemo(env.DB, {
      slug: 'ocr-seed-2',
      content: '![img](https://example.com/2.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });
    await createMemo(env.DB, {
      slug: 'ocr-seed-3',
      content: '![img](https://example.com/3.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });

    const response = await app.request('http://localhost/api/ai/ocr/run', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session' },
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as OcrQueueRunResponse;
    expect(payload.scanned).toBe(2);
    expect(payload.processed).toBe(1);
    expect(payload.status.total).toBe(2);
    expect(payload.status.pending).toBe(1);
  });

  it('does not seed more historical memos when retryable OCR tasks already exist', async () => {
    const env = await createTestEnv();
    env.OCR_SEED_BATCH_SIZE = '2';
    env.OCR_BATCH_SIZE = '1';

    const queuedMemo = await createMemo(env.DB, {
      slug: 'ocr-queued',
      content: '![img](https://example.com/queued.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });
    await syncMemoImageOcrTasks(env.DB, queuedMemo.id, queuedMemo.content, queuedMemo.visibility);

    await createMemo(env.DB, {
      slug: 'ocr-unseeded',
      content: '![img](https://example.com/unseeded.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });

    const response = await app.request('http://localhost/api/ai/ocr/run', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session' },
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as OcrQueueRunResponse;
    expect(payload.scanned).toBe(0);
    expect(payload.processed).toBe(1);
    expect(payload.status.total).toBe(1);
  });
});
