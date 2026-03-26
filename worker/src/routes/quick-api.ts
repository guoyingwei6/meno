import { Hono } from 'hono';
import { createMemo } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { isApiKeyValid } from '../lib/auth';
import { createMemoSlug } from '../lib/slug';

export const quickApiRoutes = new Hono<{ Bindings: WorkerBindings }>();

// Middleware: API token auth
quickApiRoutes.use('/*', async (c, next) => {
  if (!isApiKeyValid(c.env, c.req.raw)) {
    return c.json({ message: 'Invalid API token' }, 401);
  }
  await next();
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
    visibility?: 'public' | 'private' | 'draft';
    images?: string[];
  }>();

  let content = body.content || '';
  const visibility = body.visibility || 'public';
  const today = new Date().toISOString().slice(0, 10);

  // Append images as markdown
  if (body.images && body.images.length > 0) {
    const imgMarkdown = body.images.map((url) => `![](${url})`).join('\n');
    content = content ? `${content}\n${imgMarkdown}` : imgMarkdown;
  }

  const memo = await createMemo(c.env.DB, {
    slug: createMemoSlug(),
    content,
    visibility,
    displayDate: today,
  });

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

  if (!file || !(file instanceof File)) {
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
