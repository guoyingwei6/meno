import { Hono } from 'hono';
import { createAsset } from '../db/asset-repository';
import type { WorkerBindings } from '../db/client';
import { isAuthorSession } from '../lib/auth';
import { getAssetResponse, storeUpload } from '../storage/r2';

const createUploadKey = (filename: string): string => {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  const ms = pad(now.getMilliseconds(), 3);
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return `uploads/${y}/${m}/${y}${m}${d}${h}${min}${s}${ms}${ext}`;
};

export const uploadRoutes = new Hono<{ Bindings: WorkerBindings }>();

uploadRoutes.post('/upload-url', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{ filename: string; contentType: string }>();
  const objectKey = createUploadKey(body.filename);

  return c.json({
    uploadUrl: `${c.env.ASSET_PUBLIC_BASE_URL}/${objectKey}`,
    objectKey,
  });
});

uploadRoutes.post('/uploads', async (c) => {
  if (!isAuthorSession(c.req.header('Cookie'))) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const form = await c.req.formData();
  const file = form.get('file');

  if (!file || typeof file !== 'object' || !('name' in file) || !('arrayBuffer' in file)) {
    return c.json({ message: 'File is required' }, 400);
  }

  const uploadFile = file as File;
  const objectKey = createUploadKey(uploadFile.name);
  const url = `${c.env.ASSET_PUBLIC_BASE_URL}/${objectKey}`;
  await storeUpload(c.env.ASSETS, { objectKey, file: uploadFile });
  await createAsset(c.env.DB, {
    objectKey,
    originalUrl: url,
    mimeType: uploadFile.type || 'application/octet-stream',
  });

  return c.json({
    url,
    objectKey,
    fileName: uploadFile.name,
  });
});

uploadRoutes.get('/assets/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const response = await getAssetResponse(c.env.ASSETS, key, c.req.header('Range'));

  if (!response) {
    return c.json({ message: 'Asset not found' }, 404);
  }

  return response;
});
