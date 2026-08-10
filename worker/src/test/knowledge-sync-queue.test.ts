import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMemo, trashMemo, updateMemo } from '../db/memo-repository';
import {
  claimKnowledgeSyncQueueJob,
  completeKnowledgeSyncQueueJob,
  failKnowledgeSyncQueueJob,
  getMemoKnowledgeSyncQueueJob,
  listDueKnowledgeSyncQueueJobs,
} from '../db/knowledge-sync-repository';
import { applySchema } from '../db/schema';
import type { WorkerBindings } from '../db/client';
import { enqueueMemoKnowledgeSync, processKnowledgeSyncQueue } from '../lib/knowledge-sync-queue';
import { createTestD1 } from './d1-test-helpers';

const createTestDb = () => {
  const db = createTestD1();
  applySchema(db);
  return db;
};

const createKnowledgeEnv = (db: D1Database, shouldFail = false) => {
  const vectors = new Map<string, unknown>();
  const env = {
    DB: db,
    AI: {
      run: async () => {
        if (shouldFail) {
          throw new Error('embedding temporarily unavailable');
        }
        return { data: [[1, 2, 3]] };
      },
    },
    VECTORIZE: {
      upsert: async (items: unknown[]) => {
        for (const item of items as Array<{ id: string }>) {
          vectors.set(item.id, item);
        }
      },
      deleteByIds: async (ids: string[]) => {
        for (const id of ids) {
          vectors.delete(id);
        }
      },
    },
  } as unknown as WorkerBindings;

  return { env, vectors };
};

describe('knowledge sync queue', () => {
  it('deduplicates enqueue by memo and keeps the newest job', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-dedupe',
      content: 'Queue dedupe',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const firstAt = new Date('2026-08-10T00:00:00.000Z');
    const secondAt = new Date('2026-08-10T00:00:05.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, firstAt);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'old-revision-token',
      1,
      firstAt,
      new Date('2026-08-10T00:05:00.000Z'),
    )).resolves.toBe(true);
    await enqueueMemoKnowledgeSync(db, memo.id, secondAt);

    expect((await db.prepare('SELECT COUNT(*) as count FROM knowledge_sync_queue').first<{ count: number }>())?.count).toBe(1);
    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toEqual(expect.objectContaining({
      memoId: memo.id,
      attemptCount: 0,
      revision: 2,
      lastError: null,
      nextRetryAt: secondAt.toISOString(),
      processingToken: null,
      processingUntil: null,
    }));
  });

  it('fences stale claims and completion or failure after a newer revision is enqueued', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-stale-revision',
      content: 'Queue stale revision',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const firstAt = new Date('2026-08-10T00:10:00.000Z');
    const secondAt = new Date('2026-08-10T00:10:01.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, firstAt);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'old-revision-token',
      1,
      firstAt,
      new Date('2026-08-10T00:15:00.000Z'),
    )).resolves.toBe(true);
    await enqueueMemoKnowledgeSync(db, memo.id, secondAt);

    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'stale-claim-token',
      1,
      secondAt,
      new Date('2026-08-10T00:15:01.000Z'),
    )).resolves.toBe(false);
    await expect(completeKnowledgeSyncQueueJob(
      db,
      memo.id,
      'old-revision-token',
      1,
    )).resolves.toBe(false);
    await expect(failKnowledgeSyncQueueJob(
      db,
      memo.id,
      'old-revision-token',
      1,
      1,
      'stale failure',
      secondAt,
    )).resolves.toBe(false);

    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toEqual(expect.objectContaining({
      revision: 2,
      attemptCount: 0,
      lastError: null,
      nextRetryAt: secondAt.toISOString(),
      processingToken: null,
      processingUntil: null,
    }));

    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'current-revision-token',
      2,
      secondAt,
      new Date('2026-08-10T00:15:01.000Z'),
    )).resolves.toBe(true);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'concurrent-token',
      2,
      new Date('2026-08-10T00:10:02.000Z'),
      new Date('2026-08-10T00:15:02.000Z'),
    )).resolves.toBe(false);
    await expect(completeKnowledgeSyncQueueJob(
      db,
      memo.id,
      'current-revision-token',
      2,
    )).resolves.toBe(true);
    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toBeNull();
  });

  it('does not claim a failed job before retry and releases its lease for the retry', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-retry-lease',
      content: 'Queue retry lease',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const firstAt = new Date('2026-08-10T00:20:00.000Z');
    const retryAt = new Date('2026-08-10T00:20:01.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, firstAt);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'retry-token',
      1,
      firstAt,
      new Date('2026-08-10T00:25:00.000Z'),
    )).resolves.toBe(true);
    await expect(failKnowledgeSyncQueueJob(
      db,
      memo.id,
      'retry-token',
      1,
      1,
      'temporary failure',
      firstAt,
      1000,
    )).resolves.toBe(true);

    await expect(listDueKnowledgeSyncQueueJobs(db, firstAt, 10, memo.id)).resolves.toEqual([]);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'too-early-token',
      1,
      firstAt,
      new Date('2026-08-10T00:25:01.000Z'),
    )).resolves.toBe(false);
    await expect(listDueKnowledgeSyncQueueJobs(db, retryAt, 10, memo.id)).resolves.toEqual([
      expect.objectContaining({
        memoId: memo.id,
        revision: 1,
        attemptCount: 1,
        nextRetryAt: retryAt.toISOString(),
        processingToken: null,
        processingUntil: null,
      }),
    ]);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'retry-token-2',
      1,
      retryAt,
      new Date('2026-08-10T00:25:01.000Z'),
    )).resolves.toBe(true);
  });

  it('reclaims an expired lease without accepting the old completion or failure', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-expired-lease',
      content: 'Queue expired lease',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const claimedAt = new Date('2026-08-10T00:30:00.000Z');
    const expiredAt = new Date('2026-08-10T00:35:00.000Z');
    const reclaimedUntil = new Date('2026-08-10T00:40:00.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, claimedAt);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'expired-lease-token',
      1,
      claimedAt,
      expiredAt,
    )).resolves.toBe(true);
    await expect(claimKnowledgeSyncQueueJob(
      db,
      memo.id,
      'reclaimed-token',
      1,
      expiredAt,
      reclaimedUntil,
    )).resolves.toBe(true);

    await expect(completeKnowledgeSyncQueueJob(
      db,
      memo.id,
      'expired-lease-token',
      1,
    )).resolves.toBe(false);
    await expect(failKnowledgeSyncQueueJob(
      db,
      memo.id,
      'expired-lease-token',
      1,
      1,
      'expired worker failure',
      expiredAt,
    )).resolves.toBe(false);
    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toEqual(expect.objectContaining({
      revision: 1,
      attemptCount: 0,
      lastError: null,
      processingToken: 'reclaimed-token',
      processingUntil: reclaimedUntil.toISOString(),
    }));
    await expect(completeKnowledgeSyncQueueJob(
      db,
      memo.id,
      'reclaimed-token',
      1,
    )).resolves.toBe(true);
  });

  it('retains failures with exponential backoff and clears after a later success', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-retry',
      content: 'Queue retry',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const firstAt = new Date('2026-08-10T01:00:00.000Z');
    const { env, vectors } = createKnowledgeEnv(db, true);
    await enqueueMemoKnowledgeSync(db, memo.id, firstAt);

    await expect(processKnowledgeSyncQueue(env, {
      memoId: memo.id,
      now: firstAt,
      retryBaseDelayMs: 1000,
    })).resolves.toEqual(expect.objectContaining({ attempted: 1, failed: 1 }));

    const failedJob = await getMemoKnowledgeSyncQueueJob(db, memo.id);
    expect(failedJob).toEqual(expect.objectContaining({
      attemptCount: 1,
      lastError: 'embedding temporarily unavailable',
      processingToken: null,
      processingUntil: null,
      nextRetryAt: '2026-08-10T01:00:01.000Z',
    }));

    const successfulEnv = createKnowledgeEnv(db);
    await expect(processKnowledgeSyncQueue(successfulEnv.env, {
      memoId: memo.id,
      now: new Date('2026-08-10T01:00:02.000Z'),
      retryBaseDelayMs: 1000,
    })).resolves.toEqual(expect.objectContaining({ attempted: 1, succeeded: 1 }));

    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toBeNull();
    expect(successfulEnv.vectors.has(String(memo.id))).toBe(true);
    expect(vectors.has(String(memo.id))).toBe(false);
  });

  it('uses the latest deleted state to remove the vector', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-delete',
      content: 'Queue delete',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const { env, vectors } = createKnowledgeEnv(db);
    const indexedAt = new Date('2026-08-10T02:00:00.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, indexedAt);
    await processKnowledgeSyncQueue(env, { memoId: memo.id, now: indexedAt });
    expect(vectors.has(String(memo.id))).toBe(true);

    await trashMemo(db, memo.id);
    await enqueueMemoKnowledgeSync(db, memo.id, new Date('2026-08-10T02:00:01.000Z'));
    await processKnowledgeSyncQueue(env, {
      memoId: memo.id,
      now: new Date('2026-08-10T02:00:02.000Z'),
    });

    expect(vectors.has(String(memo.id))).toBe(false);
    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toBeNull();
  });

  it('removes the old vector when a memo becomes private without embedding private content', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-private-transition',
      content: 'Public content before privatization',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const { env, vectors } = createKnowledgeEnv(db);
    const embeddingRun = vi.spyOn(env.AI!, 'run');
    const indexedAt = new Date('2026-08-10T02:05:00.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, indexedAt);
    await processKnowledgeSyncQueue(env, { memoId: memo.id, now: indexedAt });
    expect(vectors.has(String(memo.id))).toBe(true);
    embeddingRun.mockClear();

    await updateMemo(db, memo.id, {
      content: 'Private content that must not reach a model',
      visibility: 'private',
    });
    const privatizedAt = new Date('2026-08-10T02:05:01.000Z');
    await enqueueMemoKnowledgeSync(db, memo.id, privatizedAt);
    await expect(processKnowledgeSyncQueue(env, { memoId: memo.id, now: privatizedAt })).resolves.toEqual(
      expect.objectContaining({ attempted: 1, succeeded: 1, failed: 0 }),
    );

    expect(embeddingRun).not.toHaveBeenCalled();
    expect(vectors.has(String(memo.id))).toBe(false);
    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toBeNull();
  });

  it('removes the vector when a public memo is cleared through the queue', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-clear-content',
      content: 'Queue clear content',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const { env, vectors } = createKnowledgeEnv(db);
    const indexedAt = new Date('2026-08-10T02:10:00.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, indexedAt);
    await expect(processKnowledgeSyncQueue(env, { memoId: memo.id, now: indexedAt })).resolves.toEqual(
      expect.objectContaining({ attempted: 1, succeeded: 1, failed: 0 }),
    );
    expect(vectors.has(String(memo.id))).toBe(true);

    await updateMemo(db, memo.id, { content: ' \n\t ' });
    const clearedAt = new Date('2026-08-10T02:10:01.000Z');
    await enqueueMemoKnowledgeSync(db, memo.id, clearedAt);
    await expect(processKnowledgeSyncQueue(env, { memoId: memo.id, now: clearedAt })).resolves.toEqual(
      expect.objectContaining({ attempted: 1, succeeded: 1, failed: 0 }),
    );

    expect(vectors.has(String(memo.id))).toBe(false);
    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toBeNull();
  });

  it('removes a cleared public vector through the queue without AI', async () => {
    const db = createTestDb();
    const memo = await createMemo(db, {
      slug: 'queue-clear-without-ai',
      content: 'Queue clear without AI',
      visibility: 'public',
      displayDate: '2026-08-10',
    });
    const { env, vectors } = createKnowledgeEnv(db);
    const indexedAt = new Date('2026-08-10T02:20:00.000Z');

    await enqueueMemoKnowledgeSync(db, memo.id, indexedAt);
    await expect(processKnowledgeSyncQueue(env, { memoId: memo.id, now: indexedAt })).resolves.toEqual(
      expect.objectContaining({ attempted: 1, succeeded: 1, failed: 0 }),
    );
    expect(vectors.has(String(memo.id))).toBe(true);

    await updateMemo(db, memo.id, { content: ' \n\t ' });
    const clearedAt = new Date('2026-08-10T02:20:01.000Z');
    await enqueueMemoKnowledgeSync(db, memo.id, clearedAt);
    const vectorOnlyEnv = { ...env, AI: undefined } as unknown as WorkerBindings;
    await expect(processKnowledgeSyncQueue(vectorOnlyEnv, { memoId: memo.id, now: clearedAt })).resolves.toEqual(
      expect.objectContaining({ attempted: 1, succeeded: 1, failed: 0 }),
    );

    expect(vectors.has(String(memo.id))).toBe(false);
    await expect(getMemoKnowledgeSyncQueueJob(db, memo.id)).resolves.toBeNull();
  });

  it('applies migration 011 on top of migrations 001 through 010', async () => {
    const db = createTestD1();
    for (let index = 1; index <= 10; index++) {
      const name = `${String(index).padStart(3, '0')}_${[
        'init',
        'add_pinned',
        'add_favorited',
        'add_memo_image_ocr',
        'add_memo_voice_notes',
        'add_shares_settings',
        'add_client_id_and_feed_indexes',
        'sync_memo_fts',
        'add_asset_client_id',
        'add_share_expiry',
      ][index - 1]}.sql`;
      db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url).pathname, 'utf8'));
    }
    db.exec(readFileSync(new URL('../../migrations/011_add_knowledge_sync_queue.sql', import.meta.url).pathname, 'utf8'));

    const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_sync_queue'").first<{ name: string }>();
    const index = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_knowledge_sync_queue_due'").first<{ name: string }>();
    expect(table?.name).toBe('knowledge_sync_queue');
    expect(index?.name).toBe('idx_knowledge_sync_queue_due');
  });
});
