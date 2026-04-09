import { Hono } from 'hono';
import { createMemo, trashMemo } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { isApiKeyValid } from '../lib/auth';
import { removeMemoFromKnowledgeBase, syncMemoToKnowledgeBase } from '../lib/ai-rag';
import { markMemoImageOcrRemovedByMemo, syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { createMemoSlug } from '../lib/slug';

export const quickApiRoutes = new Hono<{ Bindings: WorkerBindings }>();

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

const swallowKnowledgeBaseError = async (task: Promise<void>) => {
  try {
    await task;
  } catch (error) {
    console.error('Knowledge base sync failed', error);
  }
};

/** 把外部图片 URL 下载后上传到 R2，返回我们自己的 CDN URL；抓取失败的图片直接丢弃 */
async function mirrorImages(env: WorkerBindings, urls: string[]): Promise<string[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { headers: { Referer: url } });
        if (!res.ok) return null;
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        await env.ASSETS.put(key, res.body!, { httpMetadata: { contentType } });
        const baseUrl = env.ASSET_PUBLIC_BASE_URL || `${env.API_ORIGIN}/api/assets`;
        return `${baseUrl}/${key}`;
      } catch {
        return null;
      }
    })
  );
  return results.filter((u): u is string => u !== null);
}

// Middleware: API token auth
quickApiRoutes.use('/*', async (c, next) => {
  if (!isApiKeyValid(c.env, c.req.raw)) {
    return c.json({ message: 'Invalid API token' }, 401);
  }
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
    const mirrored = await mirrorImages(c.env, imgs.map((u) => u.trim()));
    const imgMarkdown = mirrored.map((url) => `![](${url})`).join('\n');
    finalContent = finalContent ? `${finalContent}\n${imgMarkdown}` : imgMarkdown;
  }

  const memo = await createMemo(c.env.DB, {
    slug: createMemoSlug(),
    content: finalContent,
    visibility,
    displayDate,
  });
  await syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility);
  await swallowKnowledgeBaseError(syncMemoToKnowledgeBase(c.env, memo.id));

  return c.json({ memo }, 201);
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
  }>();

  let content = body.content || '';
  const visibility = body.visibility || 'public';
  const today = new Date().toISOString().slice(0, 10);
  const displayDate = body.displayDate && /^\d{4}-\d{2}-\d{2}$/.test(body.displayDate)
    ? body.displayDate
    : today;

  // Append images as markdown (mirror external images to R2)
  if (body.images && body.images.length > 0) {
    const mirrored = await mirrorImages(c.env, body.images);
    const imgMarkdown = mirrored.map((url) => `![](${url})`).join('\n');
    content = content ? `${content}\n${imgMarkdown}` : imgMarkdown;
  }

  const memo = await createMemo(c.env.DB, {
    slug: createMemoSlug(),
    content,
    visibility,
    displayDate,
  });
  await syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility);
  await swallowKnowledgeBaseError(syncMemoToKnowledgeBase(c.env, memo.id));

  return c.json({ memo }, 201);
});

/**
 * POST /api/quick/upload
 * Multipart form: file
 * Returns: { url: string }
 */
quickApiRoutes.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');

  if (!isUploadFile(file)) {
    return c.json({ message: 'No file provided' }, 400);
  }

  const ext = file.name.split('.').pop() || 'bin';
  const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  await c.env.ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const baseUrl = c.env.ASSET_PUBLIC_BASE_URL || `${c.env.API_ORIGIN}/api/assets`;
  const url = `${baseUrl}/${key}`;

  return c.json({ url });
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
  await markMemoImageOcrRemovedByMemo(c.env.DB, row.id);
  await swallowKnowledgeBaseError(removeMemoFromKnowledgeBase(c.env, row.id));
  return c.json({ success: true });
});
