import { beforeEach, describe, expect, it } from 'vitest';
import { applySchema } from '../db/schema';
import { createTestD1 } from './d1-test-helpers';
import { createSession, getSessionById } from '../db/session-repository';

describe('session repository', () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestD1();
    applySchema(db);
  });

  it('creates and retrieves a persisted session', async () => {
    const session = await createSession(db, {
      id: 'session-123',
      githubUserId: '42',
      githubLogin: 'guoyingwei',
      expiresAt: '2026-03-26T00:00:00.000Z',
    });

    expect(session.id).toBe('session-123');

    const loaded = await getSessionById(db, 'session-123');
    expect(loaded).toEqual(
      expect.objectContaining({
        id: 'session-123',
        githubUserId: '42',
        githubLogin: 'guoyingwei',
      }),
    );
  });
});
