import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

const authorHeaders = {
  Cookie: 'meno_session=valid-author-session',
  Origin: 'https://meno.guoyingwei.top',
};

describe('share token and settings routes', () => {
  it('creates and revokes a share token for private memos', async () => {
    const env = await createTestEnv();

    const createResponse = await app.request('http://localhost/api/dashboard/memos/3/share', {
      method: 'POST',
      headers: authorHeaders,
    }, env);

    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json() as { share: { token: string; url: string } };
    expect(createPayload.share.token).toHaveLength(32);
    expect(createPayload.share.url).toBe(`https://meno.guoyingwei.top/share/${createPayload.share.token}`);

    const sharedResponse = await app.request(`http://localhost/api/public/shares/${createPayload.share.token}`, {}, env);
    expect(sharedResponse.status).toBe(200);
    const sharedPayload = await sharedResponse.json() as { memo: { slug: string; visibility: string } };
    expect(sharedPayload.memo.slug).toBe('private-memo-1');
    expect(sharedPayload.memo.visibility).toBe('private');

    const revokeResponse = await app.request('http://localhost/api/dashboard/memos/3/share', {
      method: 'DELETE',
      headers: authorHeaders,
    }, env);
    expect(revokeResponse.status).toBe(200);

    const afterRevoke = await app.request(`http://localhost/api/public/shares/${createPayload.share.token}`, {}, env);
    expect(afterRevoke.status).toBe(404);
  });

  it('reads default settings and updates allowed keys', async () => {
    const env = await createTestEnv();

    const initialResponse = await app.request('http://localhost/api/dashboard/settings', {
      headers: authorHeaders,
    }, env);
    expect(initialResponse.status).toBe(200);
    expect(await initialResponse.json()).toEqual({
      settings: {
        siteTitle: 'Meno',
        defaultVisibility: 'private',
      },
    });

    const updateResponse = await app.request('http://localhost/api/dashboard/settings', {
      method: 'PATCH',
      headers: {
        ...authorHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ siteTitle: '我的 Meno', defaultVisibility: 'public', ignored: 'nope' }),
    }, env);
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({
      settings: {
        siteTitle: '我的 Meno',
        defaultVisibility: 'public',
      },
    });

    const publicResponse = await app.request('http://localhost/api/public/settings', {}, env);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('Cache-Control')).toContain('s-maxage=15');
    expect(await publicResponse.json()).toEqual({ settings: { siteTitle: '我的 Meno' } });
  });

  it('supports optional share expiry and rejects expired tokens', async () => {
    const env = await createTestEnv();
    const invalid = await app.request('http://localhost/api/dashboard/memos/1/share?expiresInHours=0', {
      method: 'POST',
      headers: authorHeaders,
    }, env);
    expect(invalid.status).toBe(400);

    const createResponse = await app.request('http://localhost/api/dashboard/memos/1/share?expiresInHours=1', {
      method: 'POST',
      headers: authorHeaders,
    }, env);
    expect(createResponse.status).toBe(200);
    const payload = await createResponse.json() as { share: { token: string; expiresAt: string | null } };
    expect(payload.share.expiresAt).toEqual(expect.any(String));

    await env.DB.prepare('UPDATE memo_shares SET expires_at = ? WHERE token = ?')
      .bind(new Date(Date.now() - 60_000).toISOString(), payload.share.token)
      .run();
    const expired = await app.request(`http://localhost/api/public/shares/${payload.share.token}`, {}, env);
    expect(expired.status).toBe(404);
  });
});
