import type { MemoSummary } from '../../../shared/src/types';
import { getAssetAccess } from '../db/asset-repository';
import type { WorkerBindings } from '../db/client';

const decodeUriComponentSafely = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isSafeObjectKey = (value: string): boolean => (
  value.length > 0
  && value.length <= 1_024
  && !value.startsWith('/')
  && !value.includes('..')
  && /^[A-Za-z0-9._/-]+$/.test(value)
);

/**
 * Convert current and legacy Meno asset URLs into their canonical R2 key.
 * External URLs deliberately return null: their bytes are part of a public
 * memo only when the caller has already verified the memo itself is public.
 */
export const getMenoAssetObjectKey = (reference: string | null | undefined): string | null => {
  const normalized = decodeUriComponentSafely(reference?.trim() ?? '');
  if (!normalized) return null;

  const directKey = normalized.split(/[?#]/, 1)[0];
  if (isSafeObjectKey(directKey) && (directKey.startsWith('uploads/') || directKey.startsWith('voice-notes/'))) {
    return directKey;
  }

  // This also matches the original URL embedded inside Cloudflare image
  // resizing URLs, after the safe URI decode above.
  const match = normalized.match(/\/(?:api\/)?assets\/([^?#\s]+)/);
  const objectKey = match?.[1];
  return objectKey && isSafeObjectKey(objectKey) ? objectKey : null;
};

/**
 * Only currently public, non-deleted memos are eligible for model input.
 * Callers must check the current database row immediately before sending
 * content or an attachment to a model; queued work can outlive a visibility
 * change.
 */
export const isPublicMemoForModel = <T extends Pick<MemoSummary, 'visibility' | 'deletedAt'>>(
  memo: T | null | undefined,
): memo is T => memo?.visibility === 'public' && memo.deletedAt == null;

/**
 * An attachment may be referenced by more than one memo. Asset access uses
 * the restrictive rule, so a shared object is not model-eligible when any
 * live/deleted memo reference is private or otherwise not public.
 *
 * Unknown references fail closed. This is also used for external image URLs:
 * getAssetAccess resolves legacy/content-only references in addition to
 * normalized R2 asset rows.
 */
export const isPublicAssetForModel = async (
  env: Pick<WorkerBindings, 'DB'>,
  reference: string | null | undefined,
): Promise<boolean> => {
  const objectKey = getMenoAssetObjectKey(reference);
  if (!objectKey) {
    return false;
  }

  const access = await getAssetAccess(env.DB, objectKey);
  return access.scope === 'public';
};

export const isPublicMemoAttachmentForModel = async (
  env: Pick<WorkerBindings, 'DB'>,
  memoId: number,
  reference: string | null | undefined,
): Promise<boolean> => {
  const row = await env.DB
    .prepare('SELECT visibility, deleted_at AS deletedAt FROM memos WHERE id = ? LIMIT 1')
    .bind(memoId)
    .first<Pick<MemoSummary, 'visibility' | 'deletedAt'>>();

  if (!row || row.visibility !== 'public' || row.deletedAt != null) {
    return false;
  }

  // A public memo can link a normal external image. For Meno-managed R2
  // objects, however, asset ownership is authoritative and the restrictive
  // relation wins when the same object is also private or deleted elsewhere.
  return getMenoAssetObjectKey(reference) === null || isPublicAssetForModel(env, reference);
};

interface MemoOcrModelRow {
  image_url: string;
  ocr_text: string | null;
}

/**
 * OCR text is derived attachment content. Do not reuse a done queue row as
 * model input unless the referenced attachment is still publicly scoped.
 */
export const getPublicMemoOcrTextForModel = async (
  env: Pick<WorkerBindings, 'DB'>,
  memoId: number,
): Promise<string> => {
  const { results } = await env.DB
    .prepare(
      `SELECT image_url, ocr_text
       FROM memo_image_ocr
       WHERE memo_id = ?
         AND status = 'done'
         AND ocr_text IS NOT NULL
       ORDER BY id ASC`,
    )
    .bind(memoId)
    .all<MemoOcrModelRow>();

  const publicRows = await Promise.all(
    (results ?? []).map(async (row) => (
      await isPublicMemoAttachmentForModel(env, memoId, row.image_url) ? String(row.ocr_text).trim() : ''
    )),
  );

  return publicRows.filter(Boolean).join('\n\n');
};

/**
 * Keep image URLs out of model input when their ownership is private or
 * unknown. Public image references remain available to preserve the existing
 * public-memo RAG behavior.
 */
export const sanitizeMemoContentForModel = async (
  env: Pick<WorkerBindings, 'DB'>,
  content: string,
): Promise<string> => {
  const imagePattern = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
  const matches = [...content.matchAll(imagePattern)];
  let sanitized = content;

  for (const match of matches) {
    const fullMarkdown = match[0];
    const reference = match[1];
    if (getMenoAssetObjectKey(reference) !== null && !await isPublicAssetForModel(env, reference)) {
      sanitized = sanitized.replace(fullMarkdown, '[私密附件已隐藏]');
    }
  }

  // A private asset URL can also be pasted as plain text or a Markdown link;
  // remove it before vectorization or the external chat prompt as well.
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  for (const match of [...sanitized.matchAll(urlPattern)]) {
    const reference = match[0];
    if (getMenoAssetObjectKey(reference) !== null && !await isPublicAssetForModel(env, reference)) {
      sanitized = sanitized.replace(reference, '[私密附件已隐藏]');
    }
  }

  return sanitized;
};
