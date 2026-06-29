import type { MemoDetail } from '../../../shared/src/types';
import { getAuthorMemoById } from './memo-repository';

export interface MemoShare {
  memoId: number;
  token: string;
  createdAt: string;
  revokedAt: string | null;
}

const mapShareRow = (row: Record<string, unknown>): MemoShare => ({
  memoId: Number(row.memo_id),
  token: String(row.token),
  createdAt: String(row.created_at),
  revokedAt: row.revoked_at ? String(row.revoked_at) : null,
});

const createToken = () => crypto.randomUUID().replace(/-/g, '');

export const createMemoShare = async (db: D1Database, memoId: number): Promise<MemoShare | null> => {
  const memo = await getAuthorMemoById(db, memoId);
  if (!memo || memo.deletedAt) return null;

  const existing = await db
    .prepare('SELECT * FROM memo_shares WHERE memo_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .bind(memoId)
    .first<Record<string, unknown>>();
  if (existing) return mapShareRow(existing);

  const now = new Date().toISOString();
  const token = createToken();
  const created = await db
    .prepare('INSERT INTO memo_shares (memo_id, token, created_at, revoked_at) VALUES (?, ?, ?, NULL) RETURNING *')
    .bind(memoId, token, now)
    .first<Record<string, unknown>>();

  return created ? mapShareRow(created) : null;
};

export const revokeMemoShare = async (db: D1Database, memoId: number): Promise<boolean> => {
  const now = new Date().toISOString();
  const result = await db
    .prepare('UPDATE memo_shares SET revoked_at = ? WHERE memo_id = ? AND revoked_at IS NULL')
    .bind(now, memoId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
};

export const getSharedMemoByToken = async (db: D1Database, token: string): Promise<MemoDetail | null> => {
  const row = await db
    .prepare(
      `SELECT memos.*
       FROM memo_shares
       INNER JOIN memos ON memos.id = memo_shares.memo_id
       WHERE memo_shares.token = ?
         AND memo_shares.revoked_at IS NULL
         AND memos.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(token)
    .first<Record<string, unknown>>();

  if (!row) return null;
  return getAuthorMemoById(db, Number(row.id));
};
