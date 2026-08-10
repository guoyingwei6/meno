import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { getAssetAccess } from '../db/asset-repository';
import { createMemo } from '../db/memo-repository';
import { resolveAssetReadPolicy } from '../lib/asset-access';
import { MAX_MULTIPART_REQUEST_BYTES } from '../lib/upload-policy';
import { createTestEnv } from './route-test-helpers';

describe('POST /api/uploads', () => {
  it('stores an uploaded image in R2 and returns its public URL', async () => {
    const env = await createTestEnv();
    const form = new FormData();
    form.append('file', new File(['hello-image'], 'hello.png', { type: 'image/png' }));

    const response = await app.request(
      'http://localhost/api/uploads',
      {
        method: 'POST',
        headers: {
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: form,
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { url: string; previewUrl: string; objectKey: string; fileName: string };
    expect(payload.url).toContain('https://api.meno.guoyingwei.top/api/assets/uploads/');
    expect(payload.previewUrl).toContain('https://api.meno.guoyingwei.top/cdn-cgi/image/width=720,quality=75,format=auto/https://api.meno.guoyingwei.top/api/assets/uploads/');
    expect(payload.objectKey).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f]{64}\.png$/);
    expect(payload.fileName).toBe('hello.png');
  });

  it('persists uploaded asset metadata into the assets table', async () => {
    const env = await createTestEnv();
    const form = new FormData();
    form.append('file', new File(['hello-image'], 'hello.png', { type: 'image/png' }));

    await app.request(
      'http://localhost/api/uploads',
      {
        method: 'POST',
        headers: {
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: form,
      },
      env,
    );

    const row = await env.DB.prepare('SELECT object_key, original_url, preview_url, mime_type FROM assets LIMIT 1').first<Record<string, unknown>>();
    expect(row?.object_key).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f]{64}\.png$/);
    expect(row?.original_url).toContain('https://api.meno.guoyingwei.top/api/assets/uploads/');
    expect(row?.preview_url).toContain('https://api.meno.guoyingwei.top/cdn-cgi/image/width=720,quality=75,format=auto/https://api.meno.guoyingwei.top/api/assets/uploads/');
    expect(row?.mime_type).toBe('image/png');
  });

  it('reuses an attachment for the same client_id instead of creating a second R2 object', async () => {
    const env = await createTestEnv();
    const upload = async (name: string) => {
      const form = new FormData();
      form.append('file', new File(['same-image'], name, { type: 'image/png' }));
      form.append('client_id', 'memo-client-1:image:0');
      return app.request('http://localhost/api/uploads', {
        method: 'POST',
        headers: { Cookie: 'meno_session=valid-author-session', Origin: 'https://meno.guoyingwei.top' },
        body: form,
      }, env);
    };

    const first = await upload('first.png');
    const second = await upload('retry.png');
    const firstPayload = await first.json() as { objectKey: string };
    const secondPayload = await second.json() as { objectKey: string };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondPayload.objectKey).toBe(firstPayload.objectKey);
    const rows = await env.DB.prepare('SELECT client_id FROM assets WHERE client_id = ?').bind('memo-client-1:image:0').all();
    expect(rows.results).toHaveLength(1);
    expect((await env.ASSETS.list()).objects).toHaveLength(1);
  });

  it('serves uploaded audio assets with byte-range support', async () => {
    const env = await createTestEnv();
    const form = new FormData();
    form.append('file', new File(['0123456789'], 'hello.m4a', { type: 'audio/mp4' }));

    const uploadResponse = await app.request(
      'http://localhost/api/uploads',
      {
        method: 'POST',
        headers: {
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
        body: form,
      },
      env,
    );

    const payload = (await uploadResponse.json()) as { objectKey: string };
    const assetResponse = await app.request(
      `http://localhost/api/assets/${payload.objectKey}`,
      {
        headers: {
          Range: 'bytes=0-3',
          Cookie: 'meno_session=valid-author-session',
        },
      },
      env,
    );

    expect(assetResponse.status).toBe(206);
    expect(assetResponse.headers.get('accept-ranges')).toBe('bytes');
    expect(assetResponse.headers.get('content-range')).toBe('bytes 0-3/10');
    expect(await assetResponse.text()).toBe('0123');
  });

  it('rejects unsupported MIME types and oversized files before writing R2', async () => {
    const env = await createTestEnv();
    const unsupported = new FormData();
    unsupported.append('file', new File(['hello'], 'payload.svg', { type: 'image/svg+xml' }));
    const unsupportedResponse = await app.request('http://localhost/api/uploads', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session', Origin: 'https://meno.guoyingwei.top' },
      body: unsupported,
    }, env);
    expect(unsupportedResponse.status).toBe(400);

    const oversized = new FormData();
    oversized.append('file', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
    const oversizedResponse = await app.request('http://localhost/api/uploads', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session', Origin: 'https://meno.guoyingwei.top' },
      body: oversized,
    }, env);
    expect(oversizedResponse.status).toBe(400);
  });

  it('rejects an oversized multipart request before parsing it', async () => {
    const env = await createTestEnv();
    const form = new FormData();
    form.append('file', new File(['small'], 'small.png', { type: 'image/png' }));

    const response = await app.request('http://localhost/api/uploads', {
      method: 'POST',
      headers: {
        Cookie: 'meno_session=valid-author-session',
        Origin: 'https://meno.guoyingwei.top',
        'Content-Length': String(MAX_MULTIPART_REQUEST_BYTES + 1),
      },
      body: form,
    }, env);

    expect(response.status).toBe(413);
    expect((await env.ASSETS.list()).objects).toHaveLength(0);
  });

  it('rejects multipart forms with more than one file', async () => {
    const env = await createTestEnv();
    const form = new FormData();
    form.append('file', new File(['one'], 'one.png', { type: 'image/png' }));
    form.append('file', new File(['two'], 'two.png', { type: 'image/png' }));

    const response = await app.request('http://localhost/api/uploads', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session', Origin: 'https://meno.guoyingwei.top' },
      body: form,
    }, env);

    expect(response.status).toBe(400);
    expect((await env.ASSETS.list()).objects).toHaveLength(0);
  });

  it('keeps unassociated assets private and exposes assets referenced by public memos', async () => {
    const env = await createTestEnv();
    const form = new FormData();
    form.append('file', new File(['hello-image'], 'hello.png', { type: 'image/png' }));
    const uploadResponse = await app.request('http://localhost/api/uploads', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session', Origin: 'https://meno.guoyingwei.top' },
      body: form,
    }, env);
    const payload = (await uploadResponse.json()) as { objectKey: string };

    const anonymous = await app.request(`http://localhost/api/assets/${payload.objectKey}`, {}, env);
    expect(anonymous.status).toBe(404);

    await createMemo(env.DB, {
      slug: 'asset-public-owner',
      content: `Public image ![](${env.ASSET_PUBLIC_BASE_URL}/${payload.objectKey})`,
      visibility: 'public',
      displayDate: '2026-03-25',
    });
    expect((await getAssetAccess(env.DB, payload.objectKey)).scope).toBe('public');
    await expect(resolveAssetReadPolicy(env, payload.objectKey)).resolves.toMatchObject({
      allowed: true,
      cacheControl: expect.stringContaining('public'),
    });
    const publicResponse = await app.request(`http://localhost/api/assets/${payload.objectKey}`, {}, env);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('cache-control')).toContain('public');
  });

  it('requires a real author session for private and legacy asset paths', async () => {
    const env = await createTestEnv();
    const form = new FormData();
    form.append('file', new File(['hello-image'], 'hello.png', { type: 'image/png' }));
    const uploadResponse = await app.request('http://localhost/api/uploads', {
      method: 'POST',
      headers: { Cookie: 'meno_session=valid-author-session', Origin: 'https://meno.guoyingwei.top' },
      body: form,
    }, env);
    const payload = (await uploadResponse.json()) as { objectKey: string };

    const fake = await app.request(`http://localhost/api/assets/${payload.objectKey}`, {
      headers: { Cookie: 'meno_session=fake-session' },
    }, env);
    expect(fake.status).toBe(404);

    const legacyAnonymous = await app.request(`http://localhost/assets/${payload.objectKey}`, {}, env);
    expect(legacyAnonymous.status).toBe(404);

    const legacyFake = await app.request(`http://localhost/assets/${payload.objectKey}`, {
      headers: { Cookie: 'meno_session=fake-session' },
    }, env);
    expect(legacyFake.status).toBe(404);

    const author = await app.request(`/assets/${payload.objectKey}`, {
      headers: { Cookie: 'meno_session=valid-author-session' },
    }, env);
    expect(author.status).toBe(200);
    expect(author.headers.get('cache-control')).toBe('private, no-store');
    expect(author.headers.get('cross-origin-resource-policy')).toBe('same-site');
  });
});
