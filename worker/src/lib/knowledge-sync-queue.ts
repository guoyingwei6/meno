import type { WorkerBindings } from '../db/client';
import {
  claimKnowledgeSyncQueueJob,
  completeKnowledgeSyncQueueJob,
  enqueueMemoKnowledgeSync,
  failKnowledgeSyncQueueJob,
  listDueKnowledgeSyncQueueJobs,
} from '../db/knowledge-sync-repository';
import { syncMemoToKnowledgeBase } from './ai-rag';

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export interface ProcessKnowledgeSyncQueueOptions {
  memoId?: number;
  maxJobs?: number;
  now?: Date;
  leaseMs?: number;
  retryBaseDelayMs?: number;
}

export interface ProcessKnowledgeSyncQueueResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export type KnowledgeSyncScheduler = (task: Promise<void>) => void;

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const processKnowledgeSyncQueue = async (
  env: WorkerBindings,
  options: ProcessKnowledgeSyncQueueOptions = {},
): Promise<ProcessKnowledgeSyncQueueResult> => {
  const now = options.now ?? new Date();
  const leaseMs = Math.max(1, options.leaseMs ?? DEFAULT_LEASE_MS);
  const jobs = await listDueKnowledgeSyncQueueJobs(
    env.DB,
    now,
    options.maxJobs ?? DEFAULT_BATCH_SIZE,
    options.memoId,
  );
  const result: ProcessKnowledgeSyncQueueResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const job of jobs) {
    const token = crypto.randomUUID();
    const claimed = await claimKnowledgeSyncQueueJob(
      env.DB,
      job.memoId,
      token,
      job.revision,
      now,
      new Date(now.getTime() + leaseMs),
    );
    if (!claimed) {
      result.skipped++;
      continue;
    }

    result.attempted++;
    try {
      await syncMemoToKnowledgeBase(env, job.memoId);
      await completeKnowledgeSyncQueueJob(env.DB, job.memoId, token, job.revision);
      result.succeeded++;
    } catch (error) {
      await failKnowledgeSyncQueueJob(
        env.DB,
        job.memoId,
        token,
        job.revision,
        job.attemptCount + 1,
        toErrorMessage(error),
        now,
        options.retryBaseDelayMs,
      );
      result.failed++;
    }
  }

  return result;
};

export const scheduleMemoKnowledgeSync = (
  env: WorkerBindings,
  memoId: number,
  schedule?: KnowledgeSyncScheduler,
) => {
  const task: Promise<void> = processKnowledgeSyncQueue(env, { memoId, maxJobs: 1 }).then(
    () => undefined,
    (error) => {
      // Per-memo AI/Vectorize errors are persisted by processKnowledgeSyncQueue.
      // This log is reserved for queue infrastructure failures such as a D1 read.
      console.error('Knowledge sync queue processing failed', error);
    },
  );

  try {
    if (schedule) {
      schedule(task);
      return;
    }
  } catch {
    // Local adapters may expose an ExecutionContext method that cannot be used.
  }
  void task;
};

export { enqueueMemoKnowledgeSync };
