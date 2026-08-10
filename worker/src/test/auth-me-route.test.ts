import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('GET /api/me', () => {
  it('returns anonymous viewer when no session cookie is present', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/me', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: false,
      role: 'viewer',
      githubLogin: null,
    });
  });

  it('returns author identity when a valid session cookie is present', async () => {
    const env = await createTestEnv();

    const response = await app.request('http://localhost/api/me', {
      headers: {
        Cookie: 'meno_session=valid-author-session',
      },
    }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      role: 'author',
      githubLogin: 'guoyingwei6',
    });
  });
});
