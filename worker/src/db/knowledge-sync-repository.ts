export interface KnowledgeSyncQueueJob {
  memoId: number;
  attemptCount: number;
  revision: number;
  lastError: string | null;
  nextRetryAt: string;
  processingToken: string | null;
  processingUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeSyncQueueRow extends Record<string, unknown> {
  memo_id: number;
  attempt_count: number;
  revision: number;
  last_error: string | null;
  next_retry_at: string;
  processing_token: string | null;
  processing_until: string | null;
  created_at: string;
  updated_at: string;
}

const mapJob = (row: KnowledgeSyncQueueRow): KnowledgeSyncQueueJob => ({
  memoId: Number(row.memo_id),
  attemptCount: Number(row.attempt_count),
  revision: Number(row.revision),
  lastError: row.last_error == null ? null : String(row.last_error),
  nextRetryAt: String(row.next_retry_at),
  processingToken: row.processing_token == null ? null : String(row.processing_token),
  processingUntil: row.processing_until == null ? null : String(row.processing_until),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const getChangedRows = (result: { meta?: { changes?: number } }) => Number(result.meta?.changes ?? 0);

const assertMemoId = (memoId: number) => {
  if (!Number.isSafeInteger(memoId) || memoId <= 0) {
    throw new Error('Invalid memo id');
  }
};

export const enqueueMemoKnowledgeSync = async (
  db: D1Database,
  memoId: number,
  now = new Date(),
): Promise<void> => {
  assertMemoId(memoId);
  const timestamp = now.toISOString();

  await db
    .prepare(
      `INSERT INTO knowledge_sync_queue
       (memo_id, attempt_count, revision, last_error, next_retry_at, processing_token, processing_until, created_at, updated_at)
       VALUES (?, 0, 1, NULL, ?, NULL, NULL, ?, ?)
       ON CONFLICT(memo_id) DO UPDATE SET
         attempt_count = 0,
         revision = knowledge_sync_queue.revision + 1,
         last_error = NULL,
         next_retry_at = excluded.next_retry_at,
         processing_token = NULL,
         processing_until = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(memoId, timestamp, timestamp, timestamp)
    .run();
};

export const getMemoKnowledgeSyncQueueJob = async (
  db: D1Database,
  memoId: number,
): Promise<KnowledgeSyncQueueJob | null> => {
  assertMemoId(memoId);
  const row = await db
    .prepare('SELECT * FROM knowledge_sync_queue WHERE memo_id = ?')
    .bind(memoId)
    .first<KnowledgeSyncQueueRow>();
  return row ? mapJob(row) : null;
};

export const listDueKnowledgeSyncQueueJobs = async (
  db: D1Database,
  now: Date,
  limit: number,
  memoId?: number,
): Promise<KnowledgeSyncQueueJob[]> => {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const timestamp = now.toISOString();
  const memoFilter = memoId === undefined ? '' : ' AND memo_id = ?';
  const bindings = memoId === undefined
    ? [timestamp, timestamp, safeLimit]
    : [timestamp, timestamp, memoId, safeLimit];

  if (memoId !== undefined) {
    assertMemoId(memoId);
  }

  const { results } = await db
    .prepare(
      `SELECT *
       FROM knowledge_sync_queue
       WHERE next_retry_at <= ?
         AND (processing_until IS NULL OR processing_until <= ?)
         ${memoFilter}
       ORDER BY next_retry_at ASC, updated_at ASC, memo_id ASC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<KnowledgeSyncQueueRow>();

  return (results ?? []).map(mapJob);
};

export const claimKnowledgeSyncQueueJob = async (
  db: D1Database,
  memoId: number,
  token: string,
  jobRevision: number,
  now: Date,
  processingUntil: Date,
): Promise<boolean> => {
  assertMemoId(memoId);
  const result = await db
    .prepare(
      `UPDATE knowledge_sync_queue
       SET processing_token = ?,
           processing_until = ?,
           updated_at = ?
       WHERE memo_id = ?
         AND revision = ?
         AND next_retry_at <= ?
         AND (processing_until IS NULL OR processing_until <= ?)`,
    )
    .bind(
      token,
      processingUntil.toISOString(),
      now.toISOString(),
      memoId,
      jobRevision,
      now.toISOString(),
      now.toISOString(),
    )
    .run();

  return getChangedRows(result) > 0;
};

export const completeKnowledgeSyncQueueJob = async (
  db: D1Database,
  memoId: number,
  token: string,
  revision: number,
): Promise<boolean> => {
  assertMemoId(memoId);
  const result = await db
    .prepare('DELETE FROM knowledge_sync_queue WHERE memo_id = ? AND processing_token = ? AND revision = ?')
    .bind(memoId, token, revision)
    .run();
  if (getChangedRows(result) > 0) {
    return true;
  }

  await releaseStaleKnowledgeSyncQueueJob(db, memoId, token, revision);
  return false;
};

const releaseStaleKnowledgeSyncQueueJob = async (
  db: D1Database,
  memoId: number,
  token: string,
  revision: number,
): Promise<void> => {
  await db
    .prepare(
      `UPDATE knowledge_sync_queue
       SET processing_token = NULL,
           processing_until = NULL
       WHERE memo_id = ?
         AND processing_token = ?
         AND revision <> ?`,
    )
    .bind(memoId, token, revision)
    .run();
};

export const getKnowledgeSyncRetryDelayMs = (
  attemptCount: number,
  baseDelayMs = 1000,
  maxDelayMs = 60 * 60 * 1000,
) => {
  const safeAttemptCount = Math.max(1, Math.floor(attemptCount));
  const safeBaseDelay = Math.max(0, baseDelayMs);
  const safeMaxDelay = Math.max(safeBaseDelay, maxDelayMs);
  return Math.min(safeMaxDelay, safeBaseDelay * (2 ** Math.min(safeAttemptCount - 1, 30)));
};

export const failKnowledgeSyncQueueJob = async (
  db: D1Database,
  memoId: number,
  token: string,
  revision: number,
  attemptCount: number,
  message: string,
  now: Date,
  baseDelayMs = 1000,
): Promise<boolean> => {
  assertMemoId(memoId);
  const timestamp = now.toISOString();
  const nextRetryAt = new Date(
    now.getTime() + getKnowledgeSyncRetryDelayMs(attemptCount, baseDelayMs),
  ).toISOString();
  const result = await db
    .prepare(
      `UPDATE knowledge_sync_queue
       SET attempt_count = ?,
           last_error = ?,
           next_retry_at = ?,
           processing_token = NULL,
           processing_until = NULL,
           updated_at = ?
       WHERE memo_id = ? AND processing_token = ? AND revision = ?`,
    )
    .bind(
      Math.max(1, Math.floor(attemptCount)),
      message.slice(0, 2000),
      nextRetryAt,
      timestamp,
      memoId,
      token,
      revision,
    )
    .run();
  if (getChangedRows(result) === 0) {
    await releaseStaleKnowledgeSyncQueueJob(db, memoId, token, revision);
  }
  return getChangedRows(result) > 0;
};
