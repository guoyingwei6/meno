import { Hono } from 'hono';
import { createSession, deleteSessionById } from '../db/session-repository';
import type { WorkerBindings } from '../db/client';
import {
  extractSessionId,
  getAuthorPayload,
  getViewerPayload,
  isAllowedOrigin,
  resolveAuthorSession,
} from '../lib/auth';

export const authRoutes = new Hono<{ Bindings: WorkerBindings }>();

const sessionCookie = (value: string, maxAge: number) => {
  // A host-only cookie is still sent to this API when the browser's fetch
  // originates from the app or Pages preview. Avoid Domain= so sibling
  // subdomains cannot overwrite the session cookie.
  return `meno_session=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
};

const oauthStateCookie = (value: string, maxAge: number) => {
  // OAuth state is only consumed by the API callback. Keep it host-only and
  // callback-scoped so a sibling subdomain cannot overwrite or receive it.
  return `meno_oauth_state=${value}; Path=/api/auth/github/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
};

const clearSessionCookie = () => {
  return 'meno_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0';
};

const clearOauthStateCookie = () => {
  return 'meno_oauth_state=; Path=/api/auth/github/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
};

const hasAllowedOrigin = (c: { env: WorkerBindings; req: { header(name: string): string | undefined } }) => {
  return isAllowedOrigin(c.env, c.req.header('Origin'));
};

authRoutes.get('/me', async (c) => {
  const cookie = c.req.header('Cookie');
  const session = await resolveAuthorSession(c.env, cookie);
  if (!session) {
    // A missing cookie is an anonymous viewer. A supplied but forged,
    // expired, or revoked cookie is an authentication failure instead of a
    // silent downgrade to viewer state.
    if (extractSessionId(cookie)) {
      c.header('Set-Cookie', clearSessionCookie());
      return c.json({ message: 'Unauthorized' }, 401);
    }
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

  c.header('Set-Cookie', oauthStateCookie(state, 600));
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

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const session = await createSession(c.env.DB, {
    githubUserId: String(userPayload.id),
    githubLogin: userPayload.login,
    expiresAt,
  });

  c.header('Set-Cookie', sessionCookie(session.id, 604800));
  c.header('Set-Cookie', clearOauthStateCookie(), { append: true });
  return c.redirect(`${c.env.APP_ORIGIN}/`, 302);
});

authRoutes.post('/auth/logout', async (c) => {
  if (!hasAllowedOrigin(c)) {
    return c.json({ message: 'Invalid origin' }, 403);
  }

  const sessionId = extractSessionId(c.req.header('Cookie'));
  if (sessionId) {
    await deleteSessionById(c.env.DB, sessionId);
  }

  c.header('Set-Cookie', clearSessionCookie());
  return c.json({ success: true });
});
