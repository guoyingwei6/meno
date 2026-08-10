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
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
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

  it('generates a UUID when the caller does not provide a session id', async () => {
    const session = await createSession(db, {
      githubUserId: '42',
      githubLogin: 'guoyingwei',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(await getSessionById(db, session.id)).toEqual(expect.objectContaining({ id: session.id }));
  });

  it('does not return an expired session', async () => {
    await createSession(db, {
      id: 'expired-session',
      githubUserId: '42',
      githubLogin: 'guoyingwei',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(await getSessionById(db, 'expired-session')).toBeNull();
  });
});
