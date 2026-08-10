import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { MAX_MULTIPART_REQUEST_BYTES } from '../lib/upload-policy';
import { createTestEnv } from './route-test-helpers';

describe('quick API attachment uploads', () => {
  it('reuses an attachment for a repeated client_id', async () => {
    const env = await createTestEnv();
    const upload = async (name: string) => {
      const form = new FormData();
      form.append('file', new File(['quick-image'], name, { type: 'image/png' }));
      form.append('client_id', 'quick-memo:image:0');
      return app.request('http://localhost/api/quick/upload', {
        method: 'POST',
        headers: { 'X-API-Key': 'test-api-token' },
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
    const rows = await env.DB.prepare('SELECT client_id FROM assets WHERE client_id = ?').bind('quick-memo:image:0').all();
    expect(rows.results).toHaveLength(1);
    expect((await env.ASSETS.list()).objects).toHaveLength(1);
  });

  it('rejects oversized or multi-file multipart Quick API requests before storing objects', async () => {
    const env = await createTestEnv();
    const oversized = new FormData();
    oversized.append('file', new File(['small'], 'small.png', { type: 'image/png' }));
    const oversizedResponse = await app.request('http://localhost/api/quick/upload', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-token', 'Content-Length': String(MAX_MULTIPART_REQUEST_BYTES + 1) },
      body: oversized,
    }, env);
    expect(oversizedResponse.status).toBe(413);

    const multi = new FormData();
    multi.append('file', new File(['one'], 'one.png', { type: 'image/png' }));
    multi.append('file', new File(['two'], 'two.png', { type: 'image/png' }));
    const multiResponse = await app.request('http://localhost/api/quick/upload', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-token' },
      body: multi,
    }, env);
    expect(multiResponse.status).toBe(400);
    expect((await env.ASSETS.list()).objects).toHaveLength(0);
  });
});
