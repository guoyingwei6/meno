import { describe, expect, it } from 'vitest';
import { app } from '../index';
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
        },
        body: form,
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { url: string; objectKey: string; fileName: string };
    expect(payload.url).toContain('https://api.meno.guoyingwei.top/api/assets/uploads/');
    expect(payload.objectKey).toMatch(/^uploads\/\d{4}\/\d{2}\/\d{17}\.png$/);
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
        },
        body: form,
      },
      env,
    );

    const row = await env.DB.prepare('SELECT object_key, original_url, mime_type FROM assets LIMIT 1').first<Record<string, unknown>>();
    expect(row?.object_key).toMatch(/^uploads\/\d{4}\/\d{2}\/\d{17}\.png$/);
    expect(row?.original_url).toContain('https://api.meno.guoyingwei.top/api/assets/uploads/');
    expect(row?.mime_type).toBe('image/png');
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
        },
      },
      env,
    );

    expect(assetResponse.status).toBe(206);
    expect(assetResponse.headers.get('accept-ranges')).toBe('bytes');
    expect(assetResponse.headers.get('content-range')).toBe('bytes 0-3/10');
    expect(await assetResponse.text()).toBe('0123');
  });
});
