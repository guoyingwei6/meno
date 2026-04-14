export const storeUpload = async (
  bucket: R2Bucket,
  input: {
    objectKey: string;
    file: File;
  },
) => {
  await bucket.put(input.objectKey, await input.file.arrayBuffer(), {
    httpMetadata: {
      contentType: input.file.type || 'application/octet-stream',
    },
  });
};

const parseByteRange = (header: string, size: number) => {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  if (!startRaw && endRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, size);
    return { offset: size - length, length };
  }

  const offset = Number(startRaw);
  if (!Number.isFinite(offset) || offset < 0 || offset >= size) return null;

  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(end) || end < offset) return null;

  return {
    offset,
    length: Math.min(end, size - 1) - offset + 1,
  };
};

export const getAssetResponse = async (bucket: R2Bucket, objectKey: string, rangeHeader?: string | null) => {
  const fullObject = await bucket.get(objectKey);
  if (!fullObject) return null;

  const headers = new Headers();
  fullObject.writeHttpMetadata(headers);
  headers.set('etag', fullObject.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('accept-ranges', 'bytes');

  if (!rangeHeader) {
    return new Response(fullObject.body, { headers });
  }

  const fullBuffer = await fullObject.arrayBuffer();
  const range = parseByteRange(rangeHeader, fullBuffer.byteLength);
  if (!range) {
    headers.set('content-range', `bytes */${fullBuffer.byteLength}`);
    return new Response(null, { status: 416, headers });
  }

  const chunk = fullBuffer.slice(range.offset, range.offset + range.length);
  headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${fullBuffer.byteLength}`);
  headers.set('content-length', String(range.length));

  return new Response(chunk, {
    status: 206,
    headers,
  });
};
