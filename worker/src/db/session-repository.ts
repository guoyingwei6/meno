import type { SessionRecord } from '../types';

interface CreateSessionInput {
  id: string;
  githubUserId: string;
  githubLogin: string;
  expiresAt: string;
}

export const createSession = async (db: D1Database, input: CreateSessionInput): Promise<SessionRecord> => {
  const createdAt = new Date().toISOString();

  await db
    .prepare('INSERT INTO sessions (id, github_user_id, github_login, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(input.id, input.githubUserId, input.githubLogin, input.expiresAt, createdAt)
    .run();

  return {
    id: input.id,
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    expiresAt: input.expiresAt,
    createdAt,
  };
};

export const getSessionById = async (db: D1Database, id: string): Promise<SessionRecord | null> => {
  const row = await db
    .prepare('SELECT id, github_user_id, github_login, expires_at, created_at FROM sessions WHERE id = ? LIMIT 1')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    githubUserId: String(row.github_user_id),
    githubLogin: String(row.github_login),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  };
};
