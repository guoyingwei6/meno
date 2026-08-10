import { getSessionById } from '../db/session-repository';
import type { WorkerBindings } from '../db/client';

export const extractSessionId = (cookieHeader: string | undefined) => {
  const match = cookieHeader?.match(/(?:^|;\s*)meno_session=([^;]*)/);
  const value = match?.[1]?.trim();
  return value || null;
};

const DEFAULT_ALLOWED_ORIGINS = [
  'https://meno-680.pages.dev',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
] as const;

const normalizeOrigin = (value: string | undefined | null) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
};

/**
 * Keep CORS and the CSRF Origin check on one allow-list. APP_ORIGIN is the
 * deployment-time source of truth; the Pages preview and local dev origins
 * remain explicitly supported for existing development workflows.
 */
export const getAllowedOrigins = (env: Pick<WorkerBindings, 'APP_ORIGIN'>) => {
  const origins = new Set<string>();
  const appOrigin = normalizeOrigin(env.APP_ORIGIN);
  if (appOrigin) origins.add(appOrigin);

  for (const origin of DEFAULT_ALLOWED_ORIGINS) {
    origins.add(origin);
  }

  return origins;
};

export const isAllowedOrigin = (
  env: Pick<WorkerBindings, 'APP_ORIGIN'>,
  origin: string | undefined | null,
) => {
  const normalized = normalizeOrigin(origin);
  return normalized !== null && getAllowedOrigins(env).has(normalized);
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
  if (provided === token) return true;
  // Also accept key as query param for GET shortcuts
  const url = new URL(request.url);
  return url.searchParams.get('key') === token;
};

export const resolveAuthorSession = async (env: Pick<WorkerBindings, 'DB'>, cookieHeader: string | undefined) => {
  const sessionId = extractSessionId(cookieHeader);
  if (!sessionId) {
    return null;
  }

  return getSessionById(env.DB, sessionId);
};
