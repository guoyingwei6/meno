const readApiBaseUrl = () =>
  (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ ?? '';

export const loginUrl = () => withApiBase('/api/auth/github/login');

export const withApiBase = (path: string) => {
  const apiBaseUrl = readApiBaseUrl();

  if (!apiBaseUrl) {
    return path;
  }

  return `${apiBaseUrl}${path}`;
};
