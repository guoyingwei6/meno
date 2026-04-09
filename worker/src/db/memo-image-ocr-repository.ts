import { extractMarkdownImageUrls } from '../lib/image-content';

export interface MemoImageOcrRow {
  id: number;
  memoId: number;
  imageUrl: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'removed' | 'skipped';
  ocrText: string | null;
  attemptCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoImageOcrQueueCounts {
  total: number;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  removed: number;
}

const mapRow = (row: Record<string, unknown>): MemoImageOcrRow => ({
  id: Number(row.id),
  memoId: Number(row.memo_id),
  imageUrl: String(row.image_url),
  status: String(row.status) as MemoImageOcrRow['status'],
  ocrText: row.ocr_text ? String(row.ocr_text) : null,
  attemptCount: Number(row.attempt_count),
  lastError: row.last_error ? String(row.last_error) : null,
  nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : null,
  processedAt: row.processed_at ? String(row.processed_at) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export const syncMemoImageOcrTasks = async (db: D1Database, memoId: number, content: string, visibility: 'public' | 'private' | 'draft'): Promise<void> => {
  const now = new Date().toISOString();
  if (visibility !== 'public') {
    await db
      .prepare(
        `UPDATE memo_image_ocr
         SET status = 'removed',
             updated_at = ?
         WHERE memo_id = ?`,
      )
      .bind(now, memoId)
      .run();
    return;
  }

  const imageUrls = [...new Set(extractMarkdownImageUrls(content))];

  const { results } = await db
    .prepare('SELECT id, image_url FROM memo_image_ocr WHERE memo_id = ?')
    .bind(memoId)
    .all<{ id: number; image_url: string }>();

  const existingUrls = new Set((results ?? []).map((row) => String(row.image_url)));
  const currentUrls = new Set(imageUrls);

  for (const imageUrl of imageUrls) {
    if (existingUrls.has(imageUrl)) {
      await db
        .prepare(
          `UPDATE memo_image_ocr
           SET status = CASE WHEN status = 'removed' THEN 'pending' ELSE status END,
               updated_at = ?
           WHERE memo_id = ? AND image_url = ?`,
        )
        .bind(now, memoId, imageUrl)
        .run();
      continue;
    }

    await db
      .prepare(
        `INSERT INTO memo_image_ocr
         (memo_id, image_url, status, ocr_text, attempt_count, last_error, next_retry_at, processed_at, created_at, updated_at)
         VALUES (?, ?, 'pending', NULL, 0, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(memoId, imageUrl, now, now)
      .run();
  }

  for (const row of results ?? []) {
    const imageUrl = String(row.image_url);
    if (currentUrls.has(imageUrl)) {
      continue;
    }

    await db
      .prepare(
        `UPDATE memo_image_ocr
         SET status = 'removed',
             updated_at = ?
         WHERE memo_id = ? AND image_url = ?`,
      )
      .bind(now, memoId, imageUrl)
      .run();
  }
};

export const seedMissingMemoImageOcrTasks = async (db: D1Database, limit: number): Promise<number> => {
  const { results } = await db
    .prepare(
      `SELECT memos.id, memos.content
       FROM memos
       WHERE memos.deleted_at IS NULL
         AND memos.has_images = 1
         AND memos.visibility = 'public'
         AND NOT EXISTS (
           SELECT 1
           FROM memo_image_ocr
           WHERE memo_image_ocr.memo_id = memos.id
         )
       ORDER BY memos.id ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; content: string }>();

  let affected = 0;
  for (const row of results ?? []) {
    await syncMemoImageOcrTasks(db, Number(row.id), String(row.content));
    affected++;
  }

  return affected;
};

export const claimPendingMemoImageOcrTasks = async (db: D1Database, limit: number): Promise<MemoImageOcrRow[]> => {
  const now = new Date().toISOString();
  const { results } = await db
    .prepare(
      `SELECT memo_image_ocr.*
       FROM memo_image_ocr
       INNER JOIN memos ON memos.id = memo_image_ocr.memo_id
       WHERE memo_image_ocr.status IN ('pending', 'failed')
         AND memos.deleted_at IS NULL
         AND memos.visibility = 'public'
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY memo_image_ocr.updated_at ASC, memo_image_ocr.id ASC
       LIMIT ?`,
    )
    .bind(now, limit)
    .all();

  const claimed: MemoImageOcrRow[] = [];
  for (const row of results ?? []) {
    await db
      .prepare("UPDATE memo_image_ocr SET status = 'processing', updated_at = ? WHERE id = ?")
      .bind(now, Number((row as Record<string, unknown>).id))
      .run();
    claimed.push(mapRow(row as Record<string, unknown>));
  }

  return claimed;
};

export const markMemoImageOcrDone = async (db: D1Database, id: number, text: string): Promise<void> => {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE memo_image_ocr
       SET status = 'done',
           ocr_text = ?,
           last_error = NULL,
           next_retry_at = NULL,
           processed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(text, now, now, id)
    .run();
};

export const markMemoImageOcrFailed = async (db: D1Database, id: number, attemptCount: number, message: string): Promise<void> => {
  const now = new Date().toISOString();
  const nextRetryAt = new Date(Date.now() + Math.min(24, 2 ** Math.max(0, attemptCount)) * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `UPDATE memo_image_ocr
       SET status = 'failed',
           attempt_count = ?,
           last_error = ?,
           next_retry_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(attemptCount, message.slice(0, 500), nextRetryAt, now, id)
    .run();
};

export const countMemoImageOcrProcessedOn = async (db: D1Database, day: string): Promise<number> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM memo_image_ocr
       WHERE processed_at IS NOT NULL
         AND substr(processed_at, 1, 10) = ?`,
    )
    .bind(day)
    .first<{ count: number }>();

  return row?.count ?? 0;
};

export const getMemoImageOcrQueueCounts = async (db: D1Database): Promise<MemoImageOcrQueueCounts> => {
  const { results } = await db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM memo_image_ocr
       GROUP BY status`,
    )
    .all<{ status: MemoImageOcrRow['status']; count: number }>();

  const counts: MemoImageOcrQueueCounts = {
    total: 0,
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
    removed: 0,
  };

  for (const row of results ?? []) {
    const status = row.status;
    const count = Number(row.count) || 0;
    counts.total += count;

    if (status === 'pending' || status === 'processing' || status === 'done' || status === 'failed' || status === 'removed') {
      counts[status] = count;
    }
  }

  return counts;
};

export const getMemoOcrText = async (db: D1Database, memoId: number): Promise<string> => {
  const { results } = await db
    .prepare(
      `SELECT ocr_text
       FROM memo_image_ocr
       WHERE memo_id = ?
         AND status = 'done'
         AND ocr_text IS NOT NULL
       ORDER BY id ASC`,
    )
    .bind(memoId)
    .all<{ ocr_text: string }>();

  return (results ?? [])
    .map((row) => String(row.ocr_text).trim())
    .filter(Boolean)
    .join('\n\n');
};

export const markMemoImageOcrRemovedByMemo = async (db: D1Database, memoId: number): Promise<void> => {
  await db
    .prepare(
      `UPDATE memo_image_ocr
       SET status = 'removed',
           updated_at = ?
       WHERE memo_id = ?
         AND status IN ('pending', 'failed', 'processing')`,
    )
    .bind(new Date().toISOString(), memoId)
    .run();
};
