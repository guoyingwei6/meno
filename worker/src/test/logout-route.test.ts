import { describe, expect, it } from 'vitest';
import { getSessionById } from '../db/session-repository';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('POST /api/auth/logout', () => {
  it('clears session cookie and redirects viewer state to anonymous', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('meno_session=;');
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    expect(response.headers.get('set-cookie')).toContain('SameSite=None');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(await response.json()).toEqual({ success: true });
    expect(await getSessionById(env.DB, 'valid-author-session')).toBeNull();

    const repeated = await app.request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
      },
    }, env);
    expect(repeated.status).toBe(200);
    expect(repeated.headers.get('set-cookie')).toContain('meno_session=;');
  });
});
