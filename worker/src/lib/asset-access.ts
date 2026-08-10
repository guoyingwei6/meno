import { getAssetAccess } from '../db/asset-repository';
import type { WorkerBindings } from '../db/client';
import { resolveAuthorSession } from './auth';
import { PRIVATE_ASSET_CACHE_CONTROL, PUBLIC_ASSET_CACHE_CONTROL } from '../storage/r2';

/**
 * Public memo assets are readable without a cookie. Unassociated uploads,
 * private memo assets, and assets referenced by deleted memos stay author-only.
 * A missing/unknown database relation is deliberately treated as private.
 */
export const resolveAssetReadPolicy = async (
  env: Pick<WorkerBindings, 'DB'>,
  objectKey: string,
  cookieHeader?: string,
): Promise<{ allowed: boolean; cacheControl: string }> => {
  const access = await getAssetAccess(env.DB, objectKey);
  if (access.scope === 'public') {
    return { allowed: true, cacheControl: PUBLIC_ASSET_CACHE_CONTROL };
  }
  return {
    allowed: Boolean(await resolveAuthorSession(env, cookieHeader)),
    cacheControl: PRIVATE_ASSET_CACHE_CONTROL,
  };
};
