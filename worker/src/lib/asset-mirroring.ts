import { createAsset } from '../db/asset-repository';
import type { WorkerBindings } from '../db/client';
import { createHighEntropyUploadKey, getExtensionForMime, limitReadableStream, MAX_UPLOAD_BYTES } from './upload-policy';

export interface MirroredAsset {
  url: string;
  objectKey: string;
}

/**
 * Mirror user-supplied image URLs into R2 while retaining enough metadata for
 * access checks and scheduled orphan cleanup. A failed stream or metadata
 * write must remove the newly allocated object before returning a miss.
 */
export const mirrorExternalImages = async (env: WorkerBindings, urls: string[]): Promise<MirroredAsset[]> => {
  const results = await Promise.all(
    urls.slice(0, 8).map(async (sourceUrl) => {
      let objectKey: string | null = null;
      try {
        const response = await fetch(sourceUrl, { headers: { Referer: sourceUrl } });
        if (!response.ok) return null;

        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || '';
        const extension = getExtensionForMime(contentType);
        const rawContentLength = response.headers.get('content-length');
        const contentLength = rawContentLength === null ? null : Number(rawContentLength);
        if (
          !contentType.startsWith('image/')
          || !extension
          || (contentLength !== null && (!Number.isFinite(contentLength) || contentLength > MAX_UPLOAD_BYTES))
          || !response.body
        ) {
          return null;
        }

        objectKey = createHighEntropyUploadKey(extension);
        await env.ASSETS.put(objectKey, limitReadableStream(response.body, MAX_UPLOAD_BYTES), {
          httpMetadata: { contentType },
        });

        const baseUrl = env.ASSET_PUBLIC_BASE_URL || `${env.API_ORIGIN}/api/assets`;
        const url = `${baseUrl}/${objectKey}`;
        await createAsset(env.DB, {
          objectKey,
          originalUrl: url,
          mimeType: contentType,
          size: contentLength,
        });
        return { url, objectKey };
      } catch {
        if (objectKey) {
          try {
            await env.ASSETS.delete(objectKey);
          } catch {
            // A later cleanup pass can retry storage deletion when metadata
            // was written before the failure surfaced.
          }
        }
        return null;
      }
    }),
  );

  return results.filter((asset): asset is MirroredAsset => asset !== null);
};
