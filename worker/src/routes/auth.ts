import { Hono } from 'hono';
import { createSession } from '../db/session-repository';
import type { WorkerBindings } from '../db/client';
import { getAuthorPayload, getViewerPayload, resolveAuthorSession } from '../lib/auth';
import { createMemoSlug } from '../lib/slug';

export const authRoutes = new Hono<{ Bindings: WorkerBindings }>();

authRoutes.get('/me', async (c) => {
  const session = await resolveAuthorSession(c.env, c.req.header('Cookie'));
  if (!session) {
    return c.json(getViewerPayload());
  }

  return c.json(getAuthorPayload(c.env, session.githubLogin));
});

authRoutes.get('/auth/github/login', (c) => {
  const state = crypto.randomUUID();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${c.env.API_ORIGIN}/api/auth/github/callback`);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);

  c.header('Set-Cookie', `meno_oauth_state=${state}; Path=/; HttpOnly; SameSite=None; Secure`);
  return c.redirect(url.toString(), 302);
});

authRoutes.get('/auth/github/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const cookie = c.req.header('Cookie') ?? '';
  const match = cookie.match(/meno_oauth_state=([^;]+)/);

  if (!state || !code || !match || match[1] !== state) {
    return c.json({ message: 'Invalid OAuth state' }, 400);
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string };

  if (!tokenPayload.access_token) {
    return c.json({ message: 'GitHub token exchange failed' }, 502);
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'User-Agent': 'meno-app',
    },
  });
  const userPayload = (await userResponse.json()) as { id: number; login: string };

  if (userPayload.login !== c.env.GITHUB_ALLOWED_LOGIN) {
    return c.json({ message: 'Unauthorized GitHub account' }, 403);
  }

  const sessionId = createMemoSlug();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await createSession(c.env.DB, {
    id: sessionId,
    githubUserId: String(userPayload.id),
    githubLogin: userPayload.login,
    expiresAt,
  });

  c.header('Set-Cookie', `meno_session=${sessionId}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=604800`);
  return c.redirect(`${c.env.APP_ORIGIN}/`, 302);
});

authRoutes.post('/auth/logout', (c) => {
  c.header('Set-Cookie', 'meno_session=; Path=/; HttpOnly; Max-Age=0; SameSite=None; Secure');
  return c.json({ success: true });
});
