export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Multipart framing, the file name and the idempotency key need a little
// headroom beyond the file itself. Rejecting an obviously oversized request
// before formData() avoids parsing a body that cannot be accepted anyway.
export const MAX_MULTIPART_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
  'audio/webm': ['.webm'],
  'audio/mp4': ['.m4a', '.mp4'],
  'audio/mpeg': ['.mp3'],
  'audio/ogg': ['.ogg', '.oga'],
  'audio/wav': ['.wav'],
  'audio/x-wav': ['.wav'],
};

const getExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) return '';
  const extension = filename.slice(lastDot).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/.test(extension) ? extension : '';
};

export const getExtensionForMime = (mimeType: string): string | null => {
  const normalizedMime = mimeType.trim().toLowerCase().split(';', 1)[0];
  return MIME_EXTENSIONS[normalizedMime]?.[0] ?? null;
};

export const getAllowedExtension = (filename: string, mimeType: string): string | null => {
  const normalizedMime = mimeType.trim().toLowerCase().split(';', 1)[0];
  const extension = getExtension(filename);
  const allowedExtensions = MIME_EXTENSIONS[normalizedMime];
  if (!allowedExtensions || !allowedExtensions.includes(extension)) return null;
  return extension;
};

export const validateUpload = (input: {
  filename: unknown;
  mimeType: unknown;
  size?: unknown;
}): { extension: string } | { error: string } => {
  if (typeof input.filename !== 'string' || input.filename.length < 1 || input.filename.length > 255) {
    return { error: 'Invalid file name' };
  }
  if (typeof input.mimeType !== 'string') {
    return { error: 'Unsupported file type' };
  }
  const extension = getAllowedExtension(input.filename, input.mimeType);
  if (!extension) {
    return { error: 'Unsupported file type or extension' };
  }
  if (input.size !== undefined && (typeof input.size !== 'number' || !Number.isFinite(input.size) || input.size < 1)) {
    return { error: 'Invalid file size' };
  }
  if (typeof input.size === 'number' && input.size > MAX_UPLOAD_BYTES) {
    return { error: `File exceeds ${MAX_UPLOAD_BYTES} byte limit` };
  }
  return { extension };
};

export const exceedsMultipartUploadLimit = (contentLength: string | null | undefined): boolean => {
  if (!contentLength) return false;
  const length = Number(contentLength);
  return Number.isSafeInteger(length) && length > MAX_MULTIPART_REQUEST_BYTES;
};

export const createHighEntropyUploadKey = (extension: string): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `uploads/${year}/${month}/${id}${extension}`;
};

/** Bound an external response stream before handing it to R2. */
export const limitReadableStream = (stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> => {
  const reader = stream.getReader();
  let total = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        const chunk = next.value;
        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel('upload exceeds size limit');
          controller.error(new Error('External file exceeds size limit'));
          return;
        }
        controller.enqueue(chunk);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
};
