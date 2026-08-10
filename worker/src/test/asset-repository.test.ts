import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAsset, getAssetAccess, purgeOrphanAssets, purgeUntrackedR2Uploads } from '../db/asset-repository';
import { createMemo, purgeOldTrash, trashMemo } from '../db/memo-repository';
import { upsertMemoVoiceNote } from '../db/memo-voice-note-repository';
import { createTestEnv } from './route-test-helpers';

describe('asset repository garbage collection', () => {
  afterEach(() => vi.restoreAllMocks());

  const markMemoAsOldTrash = async (db: D1Database, memoId: number) => {
    const deletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .prepare('UPDATE memos SET deleted_at = ? WHERE id = ?')
      .bind(deletedAt, memoId)
      .run();
    return deletedAt;
  };

  it('removes stale unreferenced upload metadata and the R2 object', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/orphan.png';
    await env.ASSETS.put(objectKey, new Uint8Array([1, 2, 3]).buffer);
    await createAsset(env.DB, {
      objectKey,
      originalUrl: `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`,
      mimeType: 'image/png',
      size: 3,
    });
    await env.DB.prepare('UPDATE assets SET created_at = ?').bind(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).run();

    expect(await purgeOrphanAssets(env.DB, env.ASSETS)).toBe(1);
    expect(await env.DB.prepare('SELECT id FROM assets WHERE object_key = ?').bind(objectKey).first()).toBeNull();
    expect(await env.ASSETS.head(objectKey)).toBeNull();
  });

  it('keeps an asset referenced by memo content', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/referenced.png';
    await env.ASSETS.put(objectKey, new Uint8Array([1]).buffer);
    await createAsset(env.DB, {
      objectKey,
      originalUrl: `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`,
      mimeType: 'image/png',
      size: 1,
    });
    await env.DB.prepare('UPDATE assets SET created_at = ?').bind(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).run();
    await env.DB.prepare('UPDATE memos SET content = ? WHERE slug = ?').bind(`![](${env.ASSET_PUBLIC_BASE_URL}/${objectKey})`, 'public-memo-1').run();

    expect(await purgeOrphanAssets(env.DB, env.ASSETS)).toBe(0);
    expect(await env.ASSETS.head(objectKey)).not.toBeNull();
  });

  it('keeps a normalized asset linked to a live memo even when content has no URL', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/normalized.png';
    await env.ASSETS.put(objectKey, new Uint8Array([1]).buffer);
    await createAsset(env.DB, {
      objectKey,
      originalUrl: `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`,
      mimeType: 'image/png',
      size: 1,
      memoId: 3,
    });
    await env.DB.prepare('UPDATE assets SET created_at = ?').bind(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).run();

    expect(await purgeOrphanAssets(env.DB, env.ASSETS)).toBe(0);
    expect(await env.ASSETS.head(objectKey)).not.toBeNull();
  });

  it('uses private access when the same legacy object is referenced by public and private memos', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/shared-legacy.png';
    await createAsset(env.DB, {
      objectKey,
      originalUrl: `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`,
      mimeType: 'image/png',
      size: 1,
    });
    const url = `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
    await env.DB.prepare('UPDATE memos SET content = ? WHERE slug = ?').bind(`![](${url})`, 'public-memo-1').run();
    await env.DB.prepare('UPDATE memos SET content = ? WHERE slug = ?').bind(`![](${url})`, 'private-memo-1').run();

    expect(await getAssetAccess(env.DB, objectKey)).toMatchObject({ scope: 'private' });
  });

  it('purges old trash image, voice and asset metadata together', async () => {
    const env = await createTestEnv();
    const imageKey = 'uploads/old-trash-image.png';
    const voiceKey = 'voice-notes/old-trash-audio.m4a';
    const imageUrl = `${env.ASSET_PUBLIC_BASE_URL}/${imageKey}`;
    const memo = await createMemo(env.DB, {
      slug: 'old-trash-with-assets',
      content: `Trash with an image\n\n![](${imageUrl})`,
      visibility: 'private',
      displayDate: '2026-04-01',
    });

    await env.ASSETS.put(imageKey, new Uint8Array([1, 2, 3]).buffer);
    await env.ASSETS.put(voiceKey, new Uint8Array([4, 5, 6]).buffer);
    await createAsset(env.DB, {
      memoId: memo.id,
      objectKey: imageKey,
      originalUrl: imageUrl,
      mimeType: 'image/png',
      size: 3,
    });
    await upsertMemoVoiceNote(env.DB, {
      memoId: memo.id,
      objectKey: voiceKey,
      audioUrl: `${env.ASSET_PUBLIC_BASE_URL}/${voiceKey}`,
      mimeType: 'audio/mp4',
      durationMs: 1_000,
    });
    await trashMemo(env.DB, memo.id);
    await markMemoAsOldTrash(env.DB, memo.id);

    expect(await purgeOldTrash(env.DB, env.ASSETS)).toBe(1);
    expect(await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(memo.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM assets WHERE object_key = ?').bind(imageKey).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM memo_voice_notes WHERE object_key = ?').bind(voiceKey).first()).toBeNull();
    expect(await env.ASSETS.head(imageKey)).toBeNull();
    expect(await env.ASSETS.head(voiceKey)).toBeNull();
  });

  it('never deletes an object still referenced by another memo', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/shared-trash-image.png';
    const objectUrl = `${env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
    const trashedMemo = await createMemo(env.DB, {
      slug: 'old-trash-shared-asset',
      content: `Original image\n\n![](${objectUrl})`,
      visibility: 'private',
      displayDate: '2026-04-01',
    });
    const otherMemo = await createMemo(env.DB, {
      slug: 'live-shared-asset',
      content: `Still used here: ${objectUrl}`,
      visibility: 'private',
      displayDate: '2026-04-02',
    });

    await env.ASSETS.put(objectKey, new Uint8Array([7, 8, 9]).buffer);
    await createAsset(env.DB, {
      memoId: trashedMemo.id,
      objectKey,
      originalUrl: objectUrl,
      mimeType: 'image/png',
      size: 3,
    });
    await trashMemo(env.DB, trashedMemo.id);
    await markMemoAsOldTrash(env.DB, trashedMemo.id);

    const deletedKeys: string[] = [];
    const trackingBucket = {
      delete: async (key: string) => {
        deletedKeys.push(key);
        await env.ASSETS.delete(key);
      },
    } as unknown as R2Bucket;

    expect(await purgeOldTrash(env.DB, trackingBucket)).toBe(1);
    expect(deletedKeys).not.toContain(objectKey);
    expect(await env.ASSETS.head(objectKey)).not.toBeNull();
    expect(await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(trashedMemo.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(otherMemo.id).first()).not.toBeNull();
  });

  it('keeps trash metadata after an R2 failure so the next GC can retry', async () => {
    const env = await createTestEnv();
    const imageKey = 'uploads/retry-trash-image.png';
    const voiceKey = 'voice-notes/retry-trash-audio.m4a';
    const imageUrl = `${env.ASSET_PUBLIC_BASE_URL}/${imageKey}`;
    const memo = await createMemo(env.DB, {
      slug: 'old-trash-r2-retry',
      content: `Retry this image\n\n![](${imageUrl})`,
      visibility: 'private',
      displayDate: '2026-04-03',
    });

    await env.ASSETS.put(imageKey, new Uint8Array([1]).buffer);
    await env.ASSETS.put(voiceKey, new Uint8Array([2]).buffer);
    await createAsset(env.DB, {
      memoId: memo.id,
      objectKey: imageKey,
      originalUrl: imageUrl,
      mimeType: 'image/png',
      size: 1,
    });
    await upsertMemoVoiceNote(env.DB, {
      memoId: memo.id,
      objectKey: voiceKey,
      audioUrl: `${env.ASSET_PUBLIC_BASE_URL}/${voiceKey}`,
      mimeType: 'audio/mp4',
      durationMs: 1_000,
    });
    await trashMemo(env.DB, memo.id);
    const deletedAt = await markMemoAsOldTrash(env.DB, memo.id);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failingBucket = {
      delete: async () => {
        throw new Error('R2 unavailable');
      },
    } as unknown as R2Bucket;

    expect(await purgeOldTrash(env.DB, failingBucket)).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT id, deleted_at FROM memos WHERE id = ?').bind(memo.id).first()).toEqual({
      id: memo.id,
      deleted_at: deletedAt,
    });
    expect(await env.DB.prepare('SELECT id FROM assets WHERE object_key = ?').bind(imageKey).first()).not.toBeNull();
    expect(await env.DB.prepare('SELECT id FROM memo_voice_notes WHERE object_key = ?').bind(voiceKey).first()).not.toBeNull();
    expect(await env.ASSETS.head(imageKey)).not.toBeNull();
    expect(await env.ASSETS.head(voiceKey)).not.toBeNull();

    expect(await purgeOldTrash(env.DB, env.ASSETS)).toBe(1);
    expect(await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(memo.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM assets WHERE object_key = ?').bind(imageKey).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM memo_voice_notes WHERE object_key = ?').bind(voiceKey).first()).toBeNull();
    expect(await env.ASSETS.head(imageKey)).toBeNull();
    expect(await env.ASSETS.head(voiceKey)).toBeNull();
  });

  it('reclaims an untracked R2 upload when its metadata write and immediate cleanup both failed', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/2026/08/untracked-after-db-failure.png';
    const deleted: string[] = [];
    const listingBucket = {
      list: async ({ prefix }: { prefix?: string } = {}) => ({
        objects: prefix === 'uploads/2026/08/' ? [{ key: objectKey, uploaded: new Date('2026-08-01T00:00:00.000Z') }] : [],
        truncated: false,
        delimitedPrefixes: [],
      }),
      delete: async (key: string) => { deleted.push(key); },
    } as unknown as R2Bucket;

    expect(await purgeUntrackedR2Uploads(env.DB, listingBucket, 24, 100, new Date('2026-08-10T00:00:00.000Z'))).toBe(1);
    expect(deleted).toEqual([objectKey]);
  });

  it('does not delete a legacy object without an assets row when memo content still references it', async () => {
    const env = await createTestEnv();
    const objectKey = 'uploads/2026/08/legacy-content-only.png';
    const deleted: string[] = [];
    await env.DB.prepare('UPDATE memos SET content = ? WHERE slug = ?')
      .bind(`![](${env.ASSET_PUBLIC_BASE_URL}/${objectKey})`, 'public-memo-1')
      .run();
    const listingBucket = {
      list: async ({ prefix }: { prefix?: string } = {}) => ({
        objects: prefix === 'uploads/2026/08/' ? [{ key: objectKey, uploaded: new Date('2026-08-01T00:00:00.000Z') }] : [],
        truncated: false,
        delimitedPrefixes: [],
      }),
      delete: async (key: string) => { deleted.push(key); },
    } as unknown as R2Bucket;

    expect(await purgeUntrackedR2Uploads(env.DB, listingBucket, 24, 100, new Date('2026-08-10T00:00:00.000Z'))).toBe(0);
    expect(deleted).toEqual([]);
  });
});
