import { Hono } from 'hono';
import { createAsset, getAssetByClientId } from '../db/asset-repository';
import { createMemoWithOutcome, getMemoByClientId, normalizeClientId, trashMemo } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { isApiKeyValid } from '../lib/auth';
import { markMemoImageOcrRemovedByMemo, syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { createMemoSlug } from '../lib/slug';
import { mirrorExternalImages } from '../lib/asset-mirroring';
import { createHighEntropyUploadKey, limitReadableStream, MAX_UPLOAD_BYTES, validateUpload } from '../lib/upload-policy';
import { enqueueMemoKnowledgeSync, scheduleMemoKnowledgeSync } from '../lib/knowledge-sync-queue';

export const quickApiRoutes = new Hono<{ Bindings: WorkerBindings }>();

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_MULTIPART_REQUEST_BYTES = MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

const isUploadFile = (
  value: unknown,
): value is File & { name: string; type: string; stream: () => ReadableStream } => {
  return typeof value === 'object'
    && value !== null
    && 'name' in value
    && 'type' in value
    && 'stream' in value
    && typeof value.stream === 'function';
};

const swallowBackgroundError = async (task: Promise<void>) => {
  try {
    await task;
  } catch (error) {
    console.error('Quick API background task failed', error);
  }
};

const scheduleBackground = (c: { executionCtx?: ExecutionContext }, task: Promise<void>) => {
  const safeTask = swallowBackgroundError(task);
  try {
    const waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
    if (waitUntil) {
      waitUntil(safeTask);
      return;
    }
  } catch {
    // Fall through to the local best-effort scheduler.
  }
  void safeTask;
};

// Middleware: API token auth
quickApiRoutes.use('/*', async (c, next) => {
  if (!isApiKeyValid(c.env, c.req.raw)) {
    return c.json({ message: 'Invalid API token' }, 401);
  }
  c.header('Cache-Control', 'private, no-store');
  await next();
});

/**
 * GET /api/quick/memos
 * Query: key=<token>&content=<text>&visibility=public|private&image_urls=url1,url2&display_date=YYYY-MM-DD
 *
 * 快捷指令"打开网址"用法（最简单）：
 *   https://api.meno.guoyingwei.top/api/quick/memos?key=TOKEN&content=想法%20%23标签
 */
quickApiRoutes.get('/memos', async (c) => {
  const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  const content = decode(c.req.query('content') || '');
  const visibility = (c.req.query('visibility') || 'public') as 'public' | 'private';
  const today = new Date().toISOString().slice(0, 10);
  const displayDate = (() => {
    const d = c.req.query('display_date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  })();
  let clientId: string | undefined;
  try {
    clientId = normalizeClientId(c.req.query('client_id'));
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : 'Invalid client_id' }, 400);
  }
  if (clientId) {
    const existing = await getMemoByClientId(c.env.DB, clientId);
    if (existing) {
      await enqueueMemoKnowledgeSync(c.env.DB, existing.id);
      scheduleMemoKnowledgeSync(c.env, existing.id, (task) => scheduleBackground(c, task));
      return c.json({ memo: existing }, 200);
    }
  }

  let finalContent = content;
  const imageUrlsRaw = c.req.query('image_urls');
  if (imageUrlsRaw) {
    let imgs: string[] = [];
    const decoded = decode(imageUrlsRaw);
    if (decoded.trimStart().startsWith('[')) {
      try { imgs = JSON.parse(decoded); } catch { imgs = [decoded]; }
    } else {
      imgs = decoded.split(',').filter(Boolean);
    }
    const mirrored = await mirrorExternalImages(c.env, imgs.map((u) => u.trim()));
    const imgMarkdown = mirrored.map(({ url }) => `![](${url})`).join('\n');
    finalContent = finalContent ? `${finalContent}\n${imgMarkdown}` : imgMarkdown;
  }

  const outcome = await createMemoWithOutcome(c.env.DB, {
    slug: createMemoSlug(),
    content: finalContent,
    visibility,
    displayDate,
    clientId,
  });
  const memo = outcome.memo;
  if (outcome.created) {
    scheduleBackground(c, syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility));
  }
  await enqueueMemoKnowledgeSync(c.env.DB, memo.id);
  scheduleMemoKnowledgeSync(c.env, memo.id, (task) => scheduleBackground(c, task));

  return c.json({ memo }, outcome.created ? 201 : 200);
});

/**
 * POST /api/quick/memos
 * Body: { content: string, visibility?: string, images?: string[] }
 *
 * - content 中的 #tag 会自动解析为标签
 * - images 数组中的 URL 会追加为 markdown 图片
 * - visibility 默认 public
 *
 * 苹果快捷指令用法：
 *   POST https://api.meno.guoyingwei.top/api/quick/memos
 *   Header: X-API-Key: <your-token>
 *   Body: { "content": "想法 #标签", "images": ["https://..."] }
 */
quickApiRoutes.post('/memos', async (c) => {
  const body = await c.req.json<{
    content: string;
    visibility?: 'public' | 'private';
    images?: string[];
    displayDate?: string;
    client_id?: string;
  }>();

  let clientId: string | undefined;
  try {
    clientId = normalizeClientId(body.client_id);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : 'Invalid client_id' }, 400);
  }
  if (clientId) {
    const existing = await getMemoByClientId(c.env.DB, clientId);
    if (existing) {
      await enqueueMemoKnowledgeSync(c.env.DB, existing.id);
      scheduleMemoKnowledgeSync(c.env, existing.id, (task) => scheduleBackground(c, task));
      return c.json({ memo: existing }, 200);
    }
  }

  let content = body.content || '';
  const visibility = body.visibility || 'public';
  const today = new Date().toISOString().slice(0, 10);
  const displayDate = body.displayDate && /^\d{4}-\d{2}-\d{2}$/.test(body.displayDate)
    ? body.displayDate
    : today;

  // Append images as markdown (mirror external images to R2)
  if (body.images && body.images.length > 0) {
    const mirrored = await mirrorExternalImages(c.env, body.images);
    const imgMarkdown = mirrored.map(({ url }) => `![](${url})`).join('\n');
    content = content ? `${content}\n${imgMarkdown}` : imgMarkdown;
  }

  const outcome = await createMemoWithOutcome(c.env.DB, {
    slug: createMemoSlug(),
    content,
    visibility,
    displayDate,
    clientId,
  });
  const memo = outcome.memo;
  if (outcome.created) {
    scheduleBackground(c, syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility));
  }
  await enqueueMemoKnowledgeSync(c.env.DB, memo.id);
  scheduleMemoKnowledgeSync(c.env, memo.id, (task) => scheduleBackground(c, task));

  return c.json({ memo }, outcome.created ? 201 : 200);
});

/**
 * POST /api/quick/upload
 * Multipart form: file
 * Returns: { url: string }
 */
quickApiRoutes.post('/upload', async (c) => {
  const rawContentLength = c.req.header('Content-Length');
  if (rawContentLength !== undefined) {
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return c.json({ message: 'Invalid Content-Length' }, 400);
    }
    if (contentLength > MAX_MULTIPART_REQUEST_BYTES) {
      return c.json({ message: `Upload request exceeds ${MAX_UPLOAD_BYTES} byte file limit` }, 413);
    }
  }

  const formData = await c.req.formData();
  const fileEntries = formData.getAll('file');

  if (fileEntries.length !== 1 || !isUploadFile(fileEntries[0])) {
    return c.json({ message: fileEntries.length > 1 ? 'Only one file is allowed' : 'No file provided' }, 400);
  }
  const file = fileEntries[0];

  let clientId: string | undefined;
  try {
    clientId = normalizeClientId(formData.get('client_id'));
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : 'Invalid client_id' }, 400);
  }

  const validation = validateUpload({ filename: file.name, mimeType: file.type, size: file.size });
  if ('error' in validation) return c.json({ message: validation.error }, 400);

  if (clientId) {
    const existing = await getAssetByClientId(c.env.DB, clientId);
    if (existing) return c.json({ url: existing.originalUrl, objectKey: existing.objectKey });
  }

  const key = createHighEntropyUploadKey(validation.extension);
  const baseUrl = c.env.ASSET_PUBLIC_BASE_URL || `${c.env.API_ORIGIN}/api/assets`;
  const url = `${baseUrl}/${key}`;

  try {
    await c.env.ASSETS.put(key, limitReadableStream(file.stream(), MAX_UPLOAD_BYTES), {
      httpMetadata: { contentType: file.type },
    });
    await createAsset(c.env.DB, {
      clientId,
      objectKey: key,
      originalUrl: url,
      mimeType: file.type,
      size: file.size,
    });
  } catch (error) {
    if (clientId) {
      const existing = await getAssetByClientId(c.env.DB, clientId);
      if (existing) {
        try {
          await c.env.ASSETS.delete(key);
        } catch {
          // Scheduled orphan GC can remove the losing object.
        }
        return c.json({ url: existing.originalUrl, objectKey: existing.objectKey });
      }
    }
    try {
      await c.env.ASSETS.delete(key);
    } catch {
      // Leave metadata/storage for scheduled cleanup if the delete itself fails.
    }
    throw error;
  }

  return c.json({ url, objectKey: key });
});

/**
 * DELETE /api/quick/memos/:slug
 * Trash a memo by slug (for import cleanup)
 */
quickApiRoutes.delete('/memos/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await c.env.DB.prepare('SELECT id FROM memos WHERE slug = ? AND deleted_at IS NULL LIMIT 1')
    .bind(slug)
    .first<{ id: number }>();
  if (!row) return c.json({ message: 'Not found' }, 404);
  await trashMemo(c.env.DB, row.id);
  scheduleBackground(c, markMemoImageOcrRemovedByMemo(c.env.DB, row.id));
  await enqueueMemoKnowledgeSync(c.env.DB, row.id);
  scheduleMemoKnowledgeSync(c.env, row.id, (task) => scheduleBackground(c, task));
  return c.json({ success: true });
});
