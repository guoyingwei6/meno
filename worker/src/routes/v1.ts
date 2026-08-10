import { Hono } from 'hono';
import type { Context } from 'hono';
import type { MemoSummary } from '../../../shared/src/types';
import { createMemoWithOutcome, getAuthorMemoById, listAuthorMemos, trashMemo, updateMemo } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { ContractError, parseCreateMemoRequest, parseUpdateMemoRequest, parseVisibilityFilter } from '../contracts/v1';
import { isApiKeyValid } from '../lib/auth';
import { createMemoSlug } from '../lib/slug';
import { markMemoImageOcrRemovedByMemo, syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { enqueueMemoKnowledgeSync, scheduleMemoKnowledgeSync } from '../lib/knowledge-sync-queue';

export const v1Routes = new Hono<{ Bindings: WorkerBindings }>();

const jsonError = (c: Context<{ Bindings: WorkerBindings }>, error: unknown) => {
  if (error instanceof ContractError) {
    return c.json({ message: error.message }, 400);
  }
  throw error;
};

const parseMemoId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const waitForBackgroundTask = async (task: Promise<void>) => {
  try {
    await task;
  } catch (error) {
    console.error('V1 background task failed', error);
  }
};

const getWaitUntil = (c: Context<{ Bindings: WorkerBindings }>) => {
  try {
    return c.executionCtx?.waitUntil?.bind(c.executionCtx) ?? null;
  } catch {
    return null;
  }
};

const scheduleBackground = (c: Context<{ Bindings: WorkerBindings }>, task: Promise<void>) => {
  const safeTask = waitForBackgroundTask(task);
  const waitUntil = getWaitUntil(c);
  if (waitUntil) {
    waitUntil(safeTask);
  } else {
    void safeTask;
  }
};

v1Routes.use('/*', async (c, next) => {
  if (!isApiKeyValid(c.env, c.req.raw)) {
    return c.json({ message: 'Invalid API token' }, 401);
  }
  c.header('Cache-Control', 'private, no-store');
  await next();
});

v1Routes.get('/memos', async (c) => {
  try {
    const visibility = parseVisibilityFilter(c.req.query('visibility'));
    const date = c.req.query('date');
    const view = visibility === 'trash' ? 'trash' : visibility === 'all' ? 'all' : visibility;
    const memos = await listAuthorMemos(c.env.DB, { view, date });
    return c.json({ memos });
  } catch (error) {
    return jsonError(c, error);
  }
});

v1Routes.post('/memos', async (c) => {
  try {
    const input = parseCreateMemoRequest(await c.req.json());
    const outcome = await createMemoWithOutcome(c.env.DB, {
      slug: createMemoSlug(),
      content: input.content,
      visibility: input.visibility,
      displayDate: input.displayDate,
      clientId: input.client_id,
    });
    const memo = outcome.memo;

    if (outcome.created) {
      scheduleBackground(c, syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility));
    }
    await enqueueMemoKnowledgeSync(c.env.DB, memo.id);
    scheduleMemoKnowledgeSync(c.env, memo.id, getWaitUntil(c) ?? undefined);

    return c.json({ memo }, outcome.created ? 201 : 200);
  } catch (error) {
    return jsonError(c, error);
  }
});

v1Routes.get('/memos/:id', async (c) => {
  const id = parseMemoId(c.req.param('id'));
  if (!id) {
    return c.json({ message: 'Invalid memo id' }, 400);
  }

  const memo = await getAuthorMemoById(c.env.DB, id);
  if (!memo || memo.deletedAt) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

v1Routes.patch('/memos/:id', async (c) => {
  try {
    const id = parseMemoId(c.req.param('id'));
    if (!id) {
      return c.json({ message: 'Invalid memo id' }, 400);
    }

    const input = parseUpdateMemoRequest(await c.req.json());
    const memo = await updateMemo(c.env.DB, id, input);
    if (!memo) {
      return c.json({ message: 'Memo not found' }, 404);
    }

    if (input.content !== undefined || input.visibility !== undefined) {
      scheduleBackground(c, syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility));
    }
    await enqueueMemoKnowledgeSync(c.env.DB, memo.id);
    scheduleMemoKnowledgeSync(c.env, memo.id, getWaitUntil(c) ?? undefined);

    return c.json({ memo });
  } catch (error) {
    return jsonError(c, error);
  }
});

v1Routes.delete('/memos/:id', async (c) => {
  const id = parseMemoId(c.req.param('id'));
  if (!id) {
    return c.json({ message: 'Invalid memo id' }, 400);
  }

  const deleted = await trashMemo(c.env.DB, id);
  if (!deleted) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  scheduleBackground(c, markMemoImageOcrRemovedByMemo(c.env.DB, id));
  await enqueueMemoKnowledgeSync(c.env.DB, id);
  scheduleMemoKnowledgeSync(c.env, id, getWaitUntil(c) ?? undefined);

  return c.json({ success: true });
});

v1Routes.get('/export', async (c) => {
  const [activeMemos, trashedMemos] = await Promise.all([
    listAuthorMemos(c.env.DB, { view: 'all' }),
    listAuthorMemos(c.env.DB, { view: 'trash' }),
  ]);
  const memosById = new Map<number, MemoSummary>();
  for (const memo of [...activeMemos, ...trashedMemos]) {
    memosById.set(memo.id, memo);
  }

  return c.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    memos: Array.from(memosById.values()).sort((a, b) => a.id - b.id),
  });
});
