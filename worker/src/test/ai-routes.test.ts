import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeChatResponse, KnowledgeIndexResponse, OcrQueueRunResponse, OcrQueueStatus } from '../../../shared/src/types';
import { app } from '../index';
import { createAsset } from '../db/asset-repository';
import { createMemo, updateMemo } from '../db/memo-repository';
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
    const aiRun = vi.fn(env.AI!.run);
    env.AI = { ...env.AI, run: aiRun };

    const response = await app.request('http://localhost/api/ai/index', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as KnowledgeIndexResponse;
    expect(payload.indexed).toBe(2);
    expect(aiRun.mock.calls.every(([, input]) => !JSON.stringify(input).includes('Private memo'))).toBe(true);
  });

  it('does not index a private R2 reference or its derived OCR text through a public memo', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/model-private-shared.png';
    const assetUrl = `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
    const privateOwner = await createMemo(env.DB, {
      slug: 'model-private-asset-owner',
      content: `Private owner ![](${assetUrl})`,
      visibility: 'private',
      displayDate: '2026-04-09',
    });
    const publicMemo = await createMemo(env.DB, {
      slug: 'model-public-shared-reference',
      content: `Public wrapper ![](${assetUrl})`,
      visibility: 'public',
      displayDate: '2026-04-09',
    });
    await createAsset(env.DB, {
      memoId: privateOwner.id,
      objectKey,
      originalUrl: assetUrl,
      mimeType: 'image/png',
      size: 3,
    });
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO memo_image_ocr
         (memo_id, image_url, status, ocr_text, attempt_count, last_error, next_retry_at, processed_at, created_at, updated_at)
         VALUES (?, ?, 'done', ?, 0, NULL, NULL, ?, ?, ?)`,
      )
      .bind(publicMemo.id, assetUrl, '不得发送的私密图片文字', now, now, now)
      .run();

    const aiRun = vi.fn(env.AI!.run);
    env.AI = { ...env.AI, run: aiRun };
    const response = await app.request('http://localhost/api/ai/index', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);

    expect(response.status).toBe(200);
    const modelInput = aiRun.mock.calls
      .flatMap(([, input]) => (input as { text?: string[] }).text ?? [])
      .join('\n');
    expect(modelInput).toContain('Public wrapper');
    expect(modelInput).not.toContain(objectKey);
    expect(modelInput).not.toContain('不得发送的私密图片文字');
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
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);

    const response = await app.request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
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

  it('does not send a stale private vector match to the external chat model', async () => {
    const env = await createTestEnv();
    const privateMemo = await env.DB
      .prepare("SELECT id, content FROM memos WHERE visibility = 'private' LIMIT 1")
      .first<{ id: number; content: string }>();
    expect(privateMemo).not.toBeNull();

    const query = vi.fn(async () => ({
      matches: [{
        id: String(privateMemo!.id),
        score: 1,
        metadata: { memoId: privateMemo!.id },
      }],
    }));
    env.VECTORIZE = { ...env.VECTORIZE, query };

    let externalRequestBody: unknown;
    const externalFetch = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      externalRequestBody = init?.body;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '没有私密资料可用。' } }],
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', externalFetch);

    const response = await app.request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
      body: JSON.stringify({
        question: '完全无关的问题',
        config: { url: 'https://models.example.com/v1', apiKey: 'test', model: 'test-model' },
      }),
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as KnowledgeChatResponse;
    expect(payload.sources).toEqual([]);
    expect(externalFetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(externalRequestBody));
    expect(JSON.stringify(requestBody)).not.toContain(privateMemo!.content);
  });

  it('redacts a shared private asset URL before a public source reaches the external chat model', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/model-private-chat-source.png';
    const assetUrl = `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
    const privateOwner = await createMemo(env.DB, {
      slug: 'chat-private-asset-owner',
      content: `Private owner ![](${assetUrl})`,
      visibility: 'private',
      displayDate: '2026-04-11',
    });
    const publicMemo = await createMemo(env.DB, {
      slug: 'chat-public-shared-reference',
      content: `Public wrapper ![](${assetUrl})`,
      visibility: 'public',
      displayDate: '2026-04-11',
    });
    await createAsset(env.DB, {
      memoId: privateOwner.id,
      objectKey,
      originalUrl: assetUrl,
      mimeType: 'image/png',
      size: 3,
    });
    env.VECTORIZE = {
      ...env.VECTORIZE,
      query: vi.fn(async () => ({
        matches: [{ id: String(publicMemo.id), score: 1, metadata: { memoId: publicMemo.id } }],
      })),
    };

    let externalRequestBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      externalRequestBody = init?.body;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '已隐藏受限附件。' } }],
      }), { headers: { 'Content-Type': 'application/json' } });
    }));

    const response = await app.request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
      body: JSON.stringify({
        question: 'Public wrapper 是什么？',
        config: { url: 'https://models.example.com/v1', apiKey: 'test', model: 'test-model' },
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(String(externalRequestBody)).not.toContain(objectKey);
    expect(String(externalRequestBody)).toContain('Public wrapper');
  });

  it('does not run OCR for a memo privatized before its queued image is processed', async () => {
    const env = await createTestEnv();
    const memo = await createMemo(env.DB, {
      slug: 'ocr-private-after-queue',
      content: '![private](https://example.com/private.png)',
      visibility: 'public',
      displayDate: '2026-04-08',
    });
    await syncMemoImageOcrTasks(env.DB, memo.id, memo.content, memo.visibility);
    await updateMemo(env.DB, memo.id, { visibility: 'private' });
    const toMarkdown = vi.fn(env.AI!.toMarkdown!);
    env.AI = { ...env.AI, toMarkdown };
    await syncMemoImageOcrTasks(env.DB, memo.id, memo.content, 'private');

    const response = await app.request('http://localhost/api/ai/ocr/run', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);

    expect(response.status).toBe(200);
    expect((await response.json() as OcrQueueRunResponse).processed).toBe(0);
    expect(toMarkdown).not.toHaveBeenCalled();
    await expect(env.DB.prepare('SELECT status FROM memo_image_ocr WHERE memo_id = ?').bind(memo.id).first<{ status: string }>())
      .resolves.toEqual({ status: 'removed' });
  });

  it('does not send a shared private R2 object to OCR through a public memo', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/model-private-ocr.png';
    const assetUrl = `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
    const privateOwner = await createMemo(env.DB, {
      slug: 'ocr-private-asset-owner',
      content: `Private owner ![](${assetUrl})`,
      visibility: 'private',
      displayDate: '2026-04-10',
    });
    const publicMemo = await createMemo(env.DB, {
      slug: 'ocr-public-shared-reference',
      content: `Public wrapper ![](${assetUrl})`,
      visibility: 'public',
      displayDate: '2026-04-10',
    });
    await env.ASSETS.put(objectKey, new Uint8Array([1, 2, 3]).buffer);
    await createAsset(env.DB, {
      memoId: privateOwner.id,
      objectKey,
      originalUrl: assetUrl,
      mimeType: 'image/png',
      size: 3,
    });
    await syncMemoImageOcrTasks(env.DB, publicMemo.id, publicMemo.content, publicMemo.visibility);
    const toMarkdown = vi.fn(env.AI!.toMarkdown!);
    env.AI = { ...env.AI, toMarkdown };

    const response = await app.request('http://localhost/api/ai/ocr/run', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);

    expect(response.status).toBe(200);
    expect((await response.json() as OcrQueueRunResponse)).toMatchObject({ processed: 0, skipped: 1 });
    expect(toMarkdown).not.toHaveBeenCalled();
    await expect(env.DB.prepare('SELECT status FROM memo_image_ocr WHERE memo_id = ?').bind(publicMemo.id).first<{ status: string }>())
      .resolves.toEqual({ status: 'removed' });
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
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
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
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
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
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);

    expect(response.status).toBe(200);
    const payload = await response.json() as OcrQueueRunResponse;
    expect(payload.scanned).toBe(0);
    expect(payload.processed).toBe(1);
    expect(payload.status.total).toBe(1);
  });
});
