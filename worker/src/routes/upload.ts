import { Hono } from 'hono';
import { createAsset, getAssetByClientId } from '../db/asset-repository';
import { normalizeClientId } from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { resolveAssetReadPolicy } from '../lib/asset-access';
import { getImagePreviewUrl } from '../lib/image-preview';
import { createHighEntropyUploadKey, exceedsMultipartUploadLimit, validateUpload } from '../lib/upload-policy';
import { resolveAuthorSession } from '../lib/auth';
import { getAssetResponse, PRIVATE_ASSET_CACHE_CONTROL, storeUpload } from '../storage/r2';

export const uploadRoutes = new Hono<{ Bindings: WorkerBindings }>();

uploadRoutes.post('/upload-url', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  let body: { filename?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = await c.req.json<{ filename?: unknown; contentType?: unknown; size?: unknown }>();
  } catch {
    return c.json({ message: 'Invalid upload request' }, 400);
  }
  const validation = validateUpload({ filename: body.filename, mimeType: body.contentType, size: body.size });
  if ('error' in validation) return c.json({ message: validation.error }, 400);
  const objectKey = createHighEntropyUploadKey(validation.extension);

  return c.json({
    uploadUrl: `${c.env.ASSET_PUBLIC_BASE_URL}/${objectKey}`,
    objectKey,
  });
});

uploadRoutes.post('/uploads', async (c) => {
  if (!await resolveAuthorSession(c.env, c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  if (exceedsMultipartUploadLimit(c.req.header('Content-Length'))) {
    return c.json({ message: 'Upload request exceeds the size limit' }, 413);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ message: 'Invalid upload form' }, 400);
  }
  const files = form.getAll('file');
  const [file] = files;

  if (files.length !== 1 || !file || typeof file !== 'object' || !('name' in file) || !('stream' in file)) {
    return c.json({ message: 'Exactly one file is required' }, 400);
  }

  const uploadFile = file as File;
  let clientId: string | undefined;
  try {
    clientId = normalizeClientId(form.get('client_id'));
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : 'Invalid client_id' }, 400);
  }
  const validation = validateUpload({ filename: uploadFile.name, mimeType: uploadFile.type, size: uploadFile.size });
  if ('error' in validation) return c.json({ message: validation.error }, 400);

  if (clientId) {
    const existing = await getAssetByClientId(c.env.DB, clientId);
    if (existing) {
      return c.json({
        url: existing.originalUrl,
        previewUrl: existing.previewUrl,
        objectKey: existing.objectKey,
        fileName: uploadFile.name,
      });
    }
  }

  const objectKey = createHighEntropyUploadKey(validation.extension);
  const url = `${c.env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
  const previewUrl = uploadFile.type.startsWith('image/') ? getImagePreviewUrl(url) : null;
  try {
    await storeUpload(c.env.ASSETS, { objectKey, file: uploadFile });
    await createAsset(c.env.DB, {
      objectKey,
      clientId,
      originalUrl: url,
      previewUrl,
      mimeType: uploadFile.type,
      size: uploadFile.size,
    });
  } catch (error) {
    if (clientId) {
      const existing = await getAssetByClientId(c.env.DB, clientId);
      if (existing) {
        try {
          await c.env.ASSETS.delete(objectKey);
        } catch {
          // The newly allocated loser object is safe for scheduled GC.
        }
        return c.json({
          url: existing.originalUrl,
          previewUrl: existing.previewUrl,
          objectKey: existing.objectKey,
          fileName: uploadFile.name,
        });
      }
    }
    try {
      await c.env.ASSETS.delete(objectKey);
    } catch {
      // The scheduled orphan GC will retry if storage cleanup also fails.
    }
    throw error;
  }

  return c.json({
    url,
    previewUrl,
    objectKey,
    fileName: uploadFile.name,
  });
});

uploadRoutes.get('/assets/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const policy = await resolveAssetReadPolicy(c.env, key, c.req.header('Cookie'));
  if (!policy.allowed) {
    return c.json({ message: 'Asset not found' }, 404);
  }
  const response = await getAssetResponse(c.env.ASSETS, key, c.req.header('Range'), { cacheControl: policy.cacheControl });

  if (!response) {
    return c.json({ message: 'Asset not found' }, 404);
  }

  // Public assets may be embedded by the knowledge site; an authorized
  // private asset should not be reusable as a cross-origin tracking/resource
  // primitive even when its object key is known.
  response.headers.set('Cross-Origin-Resource-Policy', policy.cacheControl === PRIVATE_ASSET_CACHE_CONTROL ? 'same-site' : 'cross-origin');

  return response;
});
