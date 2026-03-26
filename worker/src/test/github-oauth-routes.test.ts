import { describe, expect, it, vi } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('GitHub OAuth routes', () => {
  it('redirects to GitHub authorize endpoint with state', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/auth/github/login', {}, env);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('https://github.com/login/oauth/authorize');
    expect(response.headers.get('location')).toContain('client_id=github-client-id');
    expect(response.headers.get('location')).toContain(encodeURIComponent('https://api.meno.guoyingwei.top/api/auth/github/callback'));
    expect(response.headers.get('location')).toContain('state=');
  });

  it('rejects callback when state cookie is missing', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/auth/github/callback?code=test-code&state=test-state', {}, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Invalid OAuth state' });
  });

  it('creates a session cookie after a successful callback', async () => {
    const env = await createTestEnv();
    const exchangeSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'token-123' }), { headers: { 'Content-Type': 'application/json' } }),
    ).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42, login: 'guoyingwei6' }), { headers: { 'Content-Type': 'application/json' } }),
    );

    const response = await app.request(
      'http://localhost/api/auth/github/callback?code=test-code&state=good-state',
      {
        headers: {
          Cookie: 'meno_oauth_state=good-state',
        },
      },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('meno_session=');
    expect(response.headers.get('set-cookie')).not.toContain('Domain=.guoyingwei.top');
    expect(response.headers.get('set-cookie')).toContain('SameSite=None');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('location')).toBe('https://meno.guoyingwei.top/');
    exchangeSpy.mockRestore();
  });
});
