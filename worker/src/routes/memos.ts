import { Hono } from 'hono';
import { createMemo, favoriteMemo, pinMemo, restoreMemo, trashMemo, unfavoriteMemo, unpinMemo, updateMemo } from '../db/memo-repository';
import { upsertMemoVoiceNote } from '../db/memo-voice-note-repository';
import type { WorkerBindings } from '../db/client';
import { isAuthorSession } from '../lib/auth';
import { removeMemoFromKnowledgeBase, syncMemoToKnowledgeBase } from '../lib/ai-rag';
import { markMemoImageOcrRemovedByMemo, syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { createMemoSlug } from '../lib/slug';

export const memoRoutes = new Hono<{ Bindings: WorkerBindings }>();

const swallowKnowledgeBaseError = async (task: Promise<void>) => {
  try {
    await task;
  } catch (error) {
    console.error('Knowledge base sync failed', error);
  }
};

memoRoutes.post('/memos', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    content: string;
    visibility: 'public' | 'private';
    displayDate: string;
    voiceNote?: {
      objectKey: string;
      audioUrl: string;
      mimeType: string;
      durationMs: number;
    };
  }>();

  const memo = await createMemo(c.env.DB, {
    slug: createMemoSlug(),
    content: body.content,
    visibility: body.visibility,
    displayDate: body.displayDate,
  });
  let voiceNote = null;

  if (body.voiceNote) {
    try {
      voiceNote = await upsertMemoVoiceNote(c.env.DB, {
        memoId: memo.id,
        objectKey: body.voiceNote.objectKey,
        audioUrl: body.voiceNote.audioUrl,
        mimeType: body.voiceNote.mimeType,
        durationMs: body.voiceNote.durationMs,
        transcriptStatus: 'pending',
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
  await syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility);
  await swallowKnowledgeBaseError(syncMemoToKnowledgeBase(c.env, memo.id));

  return c.json({ memo: voiceNote ? { ...memo, voiceNote } : memo }, 201);
});

memoRoutes.patch('/memos/:id', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
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

  if (body.content !== undefined) {
    await syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility);
  }

  await swallowKnowledgeBaseError(syncMemoToKnowledgeBase(c.env, memo.id));

  return c.json({ memo });
});

memoRoutes.delete('/memos/:id', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const deleted = await trashMemo(c.env.DB, Number(c.req.param('id')));

  if (!deleted) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  await markMemoImageOcrRemovedByMemo(c.env.DB, Number(c.req.param('id')));
  await swallowKnowledgeBaseError(removeMemoFromKnowledgeBase(c.env, Number(c.req.param('id'))));

  return c.json({ success: true });
});

memoRoutes.post('/memos/:id/pin', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await pinMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/unpin', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await unpinMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/favorite', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await favoriteMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/unfavorite', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  const memo = await unfavoriteMemo(c.env.DB, Number(c.req.param('id')));
  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }
  return c.json({ memo });
});

memoRoutes.post('/memos/:id/restore', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const memo = await restoreMemo(c.env.DB, Number(c.req.param('id')));

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

  await syncMemoImageOcrTasks(c.env.DB, memo.id, memo.content, memo.visibility);
  await swallowKnowledgeBaseError(syncMemoToKnowledgeBase(c.env, memo.id));

  return c.json({ memo });
});
