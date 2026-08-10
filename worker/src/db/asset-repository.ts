export type AssetAccessScope = 'public' | 'private' | 'unassociated';

export interface AssetAccess {
  scope: AssetAccessScope;
  memoIds: number[];
}

export interface AssetUploadRecord {
  objectKey: string;
  originalUrl: string;
  previewUrl: string | null;
  mimeType: string;
  size: number | null;
}

export const assetKeyExists = async (db: D1Database, objectKey: string): Promise<boolean> => {
  const row = await db
    .prepare('SELECT 1 AS present FROM assets WHERE object_key = ? LIMIT 1')
    .bind(objectKey)
    .first<{ present: number }>();
  return Boolean(row);
};

interface MemoAssetReference {
  id?: number | string | null;
  visibility?: string | null;
  deleted_at?: string | null;
}

const classifyAssetReferences = (references: MemoAssetReference[]): AssetAccess => {
  const memoIds = new Set<number>();
  let hasPublic = false;
  let hasPrivate = false;

  for (const reference of references) {
    const memoId = Number(reference.id);
    if (Number.isInteger(memoId) && memoId > 0) memoIds.add(memoId);

    // assets.memo_id=0 is the historical unassociated-upload sentinel. The
    // LEFT JOIN leaves visibility/deleted_at empty; do not turn that sentinel
    // into a private memo reference.
    if (memoId === 0 && !reference.visibility && !reference.deleted_at) {
      continue;
    }

    // Deleted memos are never public. Keep their objects author-only until
    // purge removes the memo/object pair.
    if (reference.deleted_at) {
      hasPrivate = true;
    } else if (reference.visibility === 'public') {
      hasPublic = true;
    } else {
      hasPrivate = true;
    }
  }

  // If an object is referenced by both public and private/deleted memos, the
  // restrictive reference wins. A shared object must never become anonymous
  // just because one of its references is public.
  return {
    scope: hasPrivate ? 'private' : hasPublic ? 'public' : 'unassociated',
    memoIds: Array.from(memoIds),
  };
};

/**
 * Resolve an object key against both normalized asset rows and legacy memo
 * content URLs. Uploads historically started with memo_id=0 and were later
 * referenced from Markdown, so authorization cannot rely on assets.memo_id
 * alone. A voice-note relation is also an authoritative reference.
 */
export const getAssetAccess = async (db: D1Database, objectKey: string): Promise<AssetAccess> => {
  const [assetRows, contentRows, voiceRows] = await Promise.all([
    db
      .prepare(
        `SELECT assets.memo_id AS id, memos.visibility, memos.deleted_at
         FROM assets
         LEFT JOIN memos ON memos.id = assets.memo_id
         WHERE assets.object_key = ?`,
      )
      .bind(objectKey)
      .all<MemoAssetReference>(),
    db
      .prepare('SELECT id, visibility, deleted_at FROM memos WHERE instr(content, ?) > 0')
      .bind(objectKey)
      .all<MemoAssetReference>(),
    db
      .prepare(
        `SELECT memos.id, memos.visibility, memos.deleted_at
         FROM memo_voice_notes
         INNER JOIN memos ON memos.id = memo_voice_notes.memo_id
         WHERE memo_voice_notes.object_key = ?`,
      )
      .bind(objectKey)
      .all<MemoAssetReference>(),
  ]);

  return classifyAssetReferences([
    ...(assetRows.results ?? []),
    ...(contentRows.results ?? []),
    ...(voiceRows.results ?? []),
  ]);
};

export const createAsset = async (
  db: D1Database,
  input: {
    objectKey: string;
    clientId?: string;
    originalUrl: string;
    previewUrl?: string | null;
    mimeType: string;
    size?: number | null;
    memoId?: number;
  },
) => {
    await db
    .prepare(
      'INSERT INTO assets (memo_id, client_id, object_key, original_url, preview_url, mime_type, width, height, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(input.memoId ?? 0, input.clientId ?? null, input.objectKey, input.originalUrl, input.previewUrl ?? null, input.mimeType, null, null, input.size ?? null, new Date().toISOString())
    .run();
};

export const getAssetByClientId = async (db: D1Database, clientId: string): Promise<AssetUploadRecord | null> => {
  const row = await db
    .prepare('SELECT object_key, original_url, preview_url, mime_type, size FROM assets WHERE client_id = ? LIMIT 1')
    .bind(clientId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    objectKey: String(row.object_key),
    originalUrl: String(row.original_url),
    previewUrl: row.preview_url ? String(row.preview_url) : null,
    mimeType: String(row.mime_type ?? 'application/octet-stream'),
    size: row.size === null || row.size === undefined ? null : Number(row.size),
  };
};

/** Remove abandoned uploads after a grace period, retaining content/voice references. */
export const purgeOrphanAssets = async (db: D1Database, r2: R2Bucket, graceHours = 24): Promise<number> => {
  const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT assets.id, assets.object_key
       FROM assets
       WHERE assets.created_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM memos AS linked_memos
           WHERE linked_memos.id = assets.memo_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM memos
           WHERE instr(memos.content, assets.object_key) > 0
         )
         AND NOT EXISTS (
           SELECT 1 FROM memo_voice_notes
           WHERE memo_voice_notes.object_key = assets.object_key
         )`,
    )
    .bind(cutoff)
    .all<{ id: number; object_key: string }>();

  let removed = 0;
  for (const row of results ?? []) {
    try {
      await r2.delete(row.object_key);
      await db.prepare('DELETE FROM assets WHERE id = ?').bind(row.id).run();
      removed += 1;
    } catch {
      // Keep metadata when storage deletion fails so the next scheduled GC retries it.
    }
  }
  return removed;
};

const getRecentUploadPrefixes = (now: Date): string[] => {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [current, previous].map((date) => `uploads/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/`);
};

const getRecordedAssetKeys = async (db: D1Database, keys: string[]): Promise<Set<string>> => {
  if (keys.length === 0) return new Set();
  const placeholders = keys.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT object_key FROM assets WHERE object_key IN (${placeholders})`)
    .bind(...keys)
    .all<{ object_key: string }>();
  return new Set((results ?? []).map((row) => row.object_key));
};

/**
 * A metadata write can fail after R2 accepted an upload, leaving no `assets`
 * row for purgeOrphanAssets to find. New uploads have a dated, high-entropy
 * prefix, so scan only the current and previous month in bounded pages. A
 * content or voice-note reference still protects legacy objects without rows.
 */
export const purgeUntrackedR2Uploads = async (
  db: D1Database,
  r2: R2Bucket,
  graceHours = 24,
  maxObjects = 1_000,
  now = new Date(),
): Promise<number> => {
  const cutoff = now.getTime() - Math.max(0, graceHours) * 60 * 60 * 1000;
  let remaining = Math.max(0, maxObjects);
  let removed = 0;

  for (const prefix of getRecentUploadPrefixes(now)) {
    let cursor: string | undefined;
    while (remaining > 0) {
      const page = await r2.list({ prefix, cursor, limit: Math.min(100, remaining) });
      remaining -= page.objects.length;
      const recordedKeys = await getRecordedAssetKeys(db, page.objects.map((object) => object.key));

      for (const object of page.objects) {
        if (object.uploaded.getTime() > cutoff || recordedKeys.has(object.key)) continue;
        try {
          const access = await getAssetAccess(db, object.key);
          if (access.scope !== 'unassociated') continue;
          await r2.delete(object.key);
          removed += 1;
        } catch {
          // Leave the object for a later scheduled retry if lookup or delete fails.
        }
      }

      if (!page.truncated) break;
      cursor = page.cursor;
    }
    if (remaining === 0) break;
  }

  return removed;
};
