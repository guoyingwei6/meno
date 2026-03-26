import { getSessionById } from '../db/session-repository';
import type { WorkerBindings } from '../db/client';

export const extractSessionId = (cookieHeader: string | undefined) => {
  const match = cookieHeader?.match(/meno_session=([^;]+)/);
  return match?.[1] ?? null;
};

export const isAuthorSession = (cookieHeader: string | undefined) => {
  return extractSessionId(cookieHeader) !== null;
};

export const getViewerPayload = () => ({
  authenticated: false,
  role: 'viewer' as const,
  githubLogin: null,
});

export const getAuthorPayload = (env: WorkerBindings, githubLogin: string) => ({
  authenticated: true,
  role: 'author' as const,
  githubLogin: githubLogin || env.GITHUB_ALLOWED_LOGIN || 'guoyingwei',
});

export const isApiKeyValid = (env: WorkerBindings, request: Request) => {
  const token = env.API_TOKEN;
  if (!token) return false;
  const header = request.headers.get('Authorization') || request.headers.get('X-API-Key') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
  return provided === token;
};

export const resolveAuthorSession = async (env: WorkerBindings, cookieHeader: string | undefined) => {
  const sessionId = extractSessionId(cookieHeader);
  if (!sessionId) {
    return null;
  }

  return getSessionById(env.DB, sessionId);
};
