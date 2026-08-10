import { afterEach, describe, expect, it, vi } from 'vitest';
import { mirrorExternalImages } from '../lib/asset-mirroring';
import { MAX_UPLOAD_BYTES } from '../lib/upload-policy';
import { createTestEnv } from './route-test-helpers';

describe('external asset mirroring', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records mirrored image metadata so orphan GC can reclaim it', async () => {
    const env = await createTestEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/png', 'content-length': '3' },
    })));

    const mirrored = await mirrorExternalImages(env, ['https://images.example.test/a.png']);

    expect(mirrored).toHaveLength(1);
    const row = await env.DB.prepare('SELECT object_key, mime_type, size FROM assets WHERE object_key = ?')
      .bind(mirrored[0].objectKey)
      .first<{ object_key: string; mime_type: string; size: number }>();
    expect(row).toEqual({ object_key: mirrored[0].objectKey, mime_type: 'image/png', size: 3 });
    expect(await env.ASSETS.head(mirrored[0].objectKey)).not.toBeNull();
  });

  it('rejects non-image or over-limit responses without leaving an R2 object', async () => {
    const env = await createTestEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), {
      headers: { 'content-type': 'audio/mpeg', 'content-length': '1' },
    })));

    expect(await mirrorExternalImages(env, ['https://images.example.test/not-image'])).toEqual([]);
    expect((await env.ASSETS.list()).objects).toHaveLength(0);
    expect((await env.DB.prepare('SELECT id FROM assets').all()).results).toHaveLength(0);
  });

  it('cuts off a streamed response that omits Content-Length but exceeds the limit', async () => {
    const env = await createTestEnv();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES + 1));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'image/png' },
    })));

    expect(await mirrorExternalImages(env, ['https://images.example.test/stream.png'])).toEqual([]);
    expect((await env.ASSETS.list()).objects).toHaveLength(0);
    expect((await env.DB.prepare('SELECT id FROM assets').all()).results).toHaveLength(0);
  });
});
