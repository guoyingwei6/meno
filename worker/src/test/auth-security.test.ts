import { describe, expect, it } from 'vitest';
import { createSession } from '../db/session-repository';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

const AUTHOR_ORIGIN = 'https://meno.guoyingwei.top';
const authorCookie = (id: string) => `meno_session=${id}`;

describe('cookie authentication and web security', () => {
  it('returns 401 and clears a forged /api/me cookie', async () => {
    const env = await createTestEnv();

    const response = await app.request('http://localhost/api/me', {
      headers: { Cookie: authorCookie('forged-session') },
    }, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
    expect(response.headers.get('set-cookie')).toContain('meno_session=;');
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
  });

  it('rejects forged and expired cookies before a protected write reaches the route', async () => {
    const forgedEnv = await createTestEnv();
    const forged = await app.request('http://localhost/api/memos', {
      method: 'POST',
      headers: {
        Cookie: authorCookie('forged-session'),
        Origin: AUTHOR_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'should not be created', visibility: 'private', displayDate: '2026-08-09' }),
    }, forgedEnv);
    expect(forged.status).toBe(401);

    const expiredEnv = await createTestEnv();
    await createSession(expiredEnv.DB, {
      id: 'expired-session',
      githubUserId: '42',
      githubLogin: 'guoyingwei6',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const expired = await app.request('http://localhost/api/memos', {
      method: 'POST',
      headers: {
        Cookie: authorCookie('expired-session'),
        Origin: AUTHOR_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'should not be created', visibility: 'private', displayDate: '2026-08-09' }),
    }, expiredEnv);
    expect(expired.status).toBe(401);
  });

  it('requires an allowed Origin for cookie-authenticated mutations', async () => {
    const missingOriginEnv = await createTestEnv();
    const missingOrigin = await app.request('http://localhost/api/dashboard/settings', {
      method: 'PATCH',
      headers: {
        Cookie: authorCookie('valid-author-session'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ siteTitle: 'blocked' }),
    }, missingOriginEnv);
    expect(missingOrigin.status).toBe(403);

    const maliciousOriginEnv = await createTestEnv();
    const maliciousOrigin = await app.request('http://localhost/api/dashboard/settings', {
      method: 'PATCH',
      headers: {
        Cookie: authorCookie('valid-author-session'),
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ siteTitle: 'blocked' }),
    }, maliciousOriginEnv);
    expect(maliciousOrigin.status).toBe(403);

    const allowedOriginEnv = await createTestEnv();
    const allowedOrigin = await app.request('http://localhost/api/dashboard/settings', {
      method: 'PATCH',
      headers: {
        Cookie: authorCookie('valid-author-session'),
        Origin: AUTHOR_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ siteTitle: 'allowed' }),
    }, allowedOriginEnv);
    expect(allowedOrigin.status).toBe(200);
  });

  it('revoked sessions stop author access and repeated logout remains idempotent', async () => {
    const env = await createTestEnv();
    const firstLogout = await app.request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: authorCookie('valid-author-session'),
        Origin: AUTHOR_ORIGIN,
      },
    }, env);
    expect(firstLogout.status).toBe(200);

    const afterLogout = await app.request('http://localhost/api/dashboard/stats', {
      headers: { Cookie: authorCookie('valid-author-session') },
    }, env);
    expect(afterLogout.status).toBe(401);

    const repeatedLogout = await app.request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: authorCookie('valid-author-session'),
        Origin: AUTHOR_ORIGIN,
      },
    }, env);
    expect(repeatedLogout.status).toBe(200);
    expect(repeatedLogout.headers.get('set-cookie')).toContain('meno_session=;');
  });

  it('shares the origin allow-list between CORS and mutation checks', async () => {
    const env = await createTestEnv();
    const allowed = await app.request('http://localhost/api/public/stats', {
      headers: { Origin: AUTHOR_ORIGIN },
    }, env);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(AUTHOR_ORIGIN);
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');

    const denied = await app.request('http://localhost/api/public/stats', {
      headers: { Origin: 'https://evil.example' },
    }, env);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('adds compatible response security headers', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/public/stats', {}, env);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self' data: blob: https:");
    expect(response.headers.get('content-security-policy')).toContain("media-src 'self' data: blob: https:");
    expect(response.headers.get('content-security-policy')).toContain('connect-src');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('keeps session and OAuth state cookies host-only', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/auth/github/login', {}, env);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).not.toContain('Domain=');
    expect(cookie).toContain('Path=/api/auth/github/callback');
    expect(cookie).toContain('SameSite=Lax');
  });
});
