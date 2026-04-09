import { Hono } from 'hono';
import { chatWithKnowledgeBase, indexKnowledgeBase } from '../lib/ai-rag';
import { getMemoImageOcrQueueStatus, processMemoImageOcrQueue } from '../lib/image-ocr';
import type { WorkerBindings } from '../db/client';
import { isAuthorSession } from '../lib/auth';
import type { AiChatMessage, AiConfig } from '../../../shared/src/types';

export const aiRoutes = new Hono<{ Bindings: WorkerBindings }>();

aiRoutes.use('*', async (c, next) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  await next();
});

aiRoutes.post('/index', async (c) => {
  try {
    const indexed = await indexKnowledgeBase(c.env);
    return c.json({ indexed });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : '知识库索引失败' }, 503);
  }
});

aiRoutes.post('/chat', async (c) => {
  const body = await c.req.json<{
    question?: string;
    config?: AiConfig;
    history?: AiChatMessage[];
  }>();

  if (!body.question?.trim() || !body.config?.url || !body.config.apiKey || !body.config.model) {
    return c.json({ message: '缺少必要的 AI 对话参数' }, 400);
  }

  try {
    const result = await chatWithKnowledgeBase(c.env, body.config, body.question, body.history ?? []);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '知识库对话失败';
    const status = message.includes('配置') ? 503 : message.includes('不能为空') ? 400 : 502;
    return c.json({ message }, status);
  }
});

aiRoutes.get('/ocr/status', async (c) => {
  try {
    const status = await getMemoImageOcrQueueStatus(c.env);
    return c.json(status);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : '获取 OCR 队列状态失败' }, 503);
  }
});

aiRoutes.post('/ocr/run', async (c) => {
  try {
    const result = await processMemoImageOcrQueue(c.env);
    const status = await getMemoImageOcrQueueStatus(c.env);
    return c.json({ ...result, status });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : '运行 OCR 队列失败' }, 503);
  }
});
