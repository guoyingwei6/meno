import type { SessionRecord } from '../types';

interface CreateSessionInput {
  /** Optional for deterministic repository tests; production callers omit it. */
  id?: string;
  githubUserId: string;
  githubLogin: string;
  expiresAt: string;
}

export const createSession = async (db: D1Database, input: CreateSessionInput): Promise<SessionRecord> => {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db
    .prepare('INSERT INTO sessions (id, github_user_id, github_login, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, input.githubUserId, input.githubLogin, input.expiresAt, createdAt)
    .run();

  return {
    id,
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    expiresAt: input.expiresAt,
    createdAt,
  };
};

export const getSessionById = async (db: D1Database, id: string): Promise<SessionRecord | null> => {
  const now = new Date().toISOString();
  const row = await db
    .prepare('SELECT id, github_user_id, github_login, expires_at, created_at FROM sessions WHERE id = ? AND expires_at > ? LIMIT 1')
    .bind(id, now)
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const expiresAt = String(row.expires_at);
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    return null;
  }

  return {
    id: String(row.id),
    githubUserId: String(row.github_user_id),
    githubLogin: String(row.github_login),
    expiresAt,
    createdAt: String(row.created_at),
  };
};

export const deleteSessionById = async (db: D1Database, id: string): Promise<void> => {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
};
