import { Hono } from 'hono';
import { createMemo, favoriteMemo, pinMemo, restoreMemo, trashMemo, unfavoriteMemo, unpinMemo, updateMemo } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { isAuthorSession } from '../lib/auth';
import { createMemoSlug } from '../lib/slug';

export const memoRoutes = new Hono<{ Bindings: WorkerBindings }>();

memoRoutes.post('/memos', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    content: string;
    visibility: 'public' | 'private' | 'draft';
    displayDate: string;
  }>();

  const memo = await createMemo(c.env.DB, {
    slug: createMemoSlug(),
    content: body.content,
    visibility: body.visibility,
    displayDate: body.displayDate,
  });

  return c.json({ memo }, 201);
});

memoRoutes.patch('/memos/:id', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    content?: string;
    visibility?: 'public' | 'private' | 'draft';
    displayDate?: string;
  }>();

  const memo = await updateMemo(c.env.DB, Number(c.req.param('id')), body);

  if (!memo) {
    return c.json({ message: 'Memo not found' }, 404);
  }

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

  return c.json({ memo });
});
