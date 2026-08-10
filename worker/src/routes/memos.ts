import { Hono } from 'hono';
import { createMemoWithOutcome, favoriteMemo, normalizeClientId, pinMemo, restoreMemo, trashMemo, unfavoriteMemo, unpinMemo, updateMemo } from '../db/memo-repository';
import { upsertMemoVoiceNote } from '../db/memo-voice-note-repository';
import type { WorkerBindings } from '../db/client';
import { resolveAuthorSession } from '../lib/auth';
import { markMemoImageOcrRemovedByMemo, syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { createMemoSlug } from '../lib/slug';
import { processVoiceNoteByMemoId } from '../lib/voice-transcription';
import { enqueueMemoKnowledgeSync, scheduleMemoKnowledgeSync } from '../lib/knowledge-sync-queue';

export const memoRoutes = new Hono<{ Bindings: WorkerBindings }>();

const setMemoCacheHeaders = async (c: { header: (name: string, value: string) => void }, next: () => Promise<void>) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
};

// This router is mounted at /api. Do not use a root wildcard here: it would
// also match /api/assets and leak private memo headers onto public assets.
memoRoutes.use('/memos', setMemoCacheHeaders);
memoRoutes.use('/memos/*', setMemoCacheHeaders);

const swallowBackgroundError = async (task: Promise<void>) => {
  try {
    await task;
  } catch (error) {
    console.error('Memo background task failed', error);
  }
};

const getWaitUntil = (c: { executionCtx?: ExecutionContext }) => {
  try {
    return c.executionCtx?.waitUntil?.bind(c.executionCtx) ?? null;
  } catch {
    return null;
  }
};

const scheduleBackground = (c: { executionCtx?: ExecutionContext }, task: Promise<void>) => {
  const safeTask = swallowBackgroundError(task);
  const waitUntil = getWaitUntil(c);
  if (waitUntil) {
    waitUntil(safeTask);
  } else {
    // Local adapters do not provide ExecutionContext. Keep this best-effort
    // fallback non-blocking while still preventing unhandled rejections.
    void safeTask;
  }
};

memoRoutes.post('/memos', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    content: string;
    visibility: 'public' | 'private';
    displayDate: string;
    client_id?: string;
    clientId?: string;
    voiceNote?: {
      objectKey: string;
      audioUrl: string;
      mimeType: string;
      durationMs: number;
      transcriptText?: string;
      transcriptSource?: string;
    };
  }>();

  let clientId: string | undefined;
  try {
    clientId = normalizeClientId(body.client_id ?? body.clientId);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : 'Invalid client_id' }, 400);
  }

  const outcome = await createMemoWithOutcome(c.env.DB, {
    slug: createMemoSlug(),
    content: body.content,
    visibility: body.visibility,
    displayDate: body.displayDate,
    clientId,
  });
  const memo = outcome.memo;
  let voiceNote = null;

  if (body.voiceNote && outcome.created) {
    try {
      voiceNote = await upsertMemoVoiceNote(c.env.DB, {
        memoId: memo.id,
        objectKey: body.voiceNote.objectKey,
        audioUrl: body.voiceNote.audioUrl,
        mimeType: body.voiceNote.mimeType,
        durationMs: body.voiceNote.durationMs,
        transcriptStatus: body.voiceNote.transcriptText ? 'done' : 'pending',
        transcriptText: body.voiceNote.transcriptText ?? null,
        transcriptSource: body.voiceNote.transcriptSource ?? null,
      });
    } catch (error) {
      try {
        await c.env.DB.prepare('DELETE FROM memo_tags WHERE memo_id = ?').bind(memo.id).run();
        await c.env.DB.prepare('DELETE FROM memos WHERE id = ?').bind(memo.id).run();
      } catch (cleanupError) {
        console.error('Failed to clean up memo after voice note creation failed', cleanupError);
      }
      throw error;
    }
  }
  if (outcome.created) {
    scheduleBackground(c, syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility));
  }
  await enqueueMemoKnowledgeSync(c.env.DB, memo.id);
  scheduleMemoKnowledgeSync(c.env, memo.id, getWaitUntil(c) ?? undefined);
  if (voiceNote && voiceNote.transcriptStatus === 'pending') {
    getWaitUntil(c)?.(processVoiceNoteByMemoId(c.env, memo.id));
  }

  return c.json({ memo: voiceNote ? { ...memo, voiceNote } : memo }, outcome.created ? 201 : 200);
});

memoRoutes.patch('/memos/:id', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    content?: string;
    visibility?: 'public' | 'private';
    displayDate?: string;
  }>();

  const memo = await updateMemo(c.env.DB, Number(c.req.param('id')), body);

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  if (body.content !== undefined || body.visibility !== undefined) {
    scheduleBackground(c, syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility));
  }

  await enqueueMemoKnowledgeSync(c.env.DB, memo.id);
  scheduleMemoKnowledgeSync(c.env, memo.id, getWaitUntil(c) ?? undefined);

  return c.json({ memo });
});

memoRoutes.delete('/memos/:id', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const deleted = await trashMemo(c.env.DB, Number(c.req.param('id')));

  if (!deleted) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  scheduleBackground(c, markMemoImageOcrRemovedByMemo(c.env.DB, Number(c.req.param('id'))));
  await enqueueMemoKnowledgeSync(c.env.DB, Number(c.req.param('id')));
  scheduleMemoKnowledgeSync(c.env, Number(c.req.param('id')), getWaitUntil(c) ?? undefined);

  return c.json({ success: true });
});

memoRoutes.post('/memos/:id/pin', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await pinMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/unpin', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await unpinMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/favorite', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await favoriteMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/unfavorite', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await unfavoriteMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/restore', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const memo = await restoreMemo(c.env.DB, Number(c.req.param('id')));

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  scheduleBackground(c, syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility));
  await enqueueMemoKnowledgeSync(c.env.DB, memo.id);
  scheduleMemoKnowledgeSync(c.env, memo.id, getWaitUntil(c) ?? undefined);

  return c.json({ memo });
});
