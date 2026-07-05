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
  const metadata = await bucket.head(objectKey);
  if (!metadata) return null;

  const headers = new Headers();
  metadata.writeHttpMetadata(headers);
  headers.set('etag', metadata.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('accept-ranges', 'bytes');

  if (!rangeHeader) {
    const fullObject = await bucket.get(objectKey);
    if (!fullObject) return null;
    return new Response(fullObject.body, { headers });
  }

  const range = parseByteRange(rangeHeader, metadata.size);
  if (!range) {
    headers.set('content-range', `bytes */${metadata.size}`);
    return new Response(null, { status: 416, headers });
  }

  const partialObject = await bucket.get(objectKey, { range });
  if (!partialObject) return null;

  partialObject.writeHttpMetadata(headers);
  headers.set('etag', partialObject.httpEtag);
  headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
  headers.set('content-length', String(range.length));

  return new Response(partialObject.body, {
    status: 206,
    headers,
  });
};
