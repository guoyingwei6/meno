export const createAsset = async (
  db: D1Database,
  input: {
    objectKey: string;
    originalUrl: string;
    mimeType: string;
  },
) => {
  await db
    .prepare(
      'INSERT INTO assets (memo_id, object_key, original_url, preview_url, mime_type, width, height, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(0, input.objectKey, input.originalUrl, null, input.mimeType, null, null, null, new Date().toISOString())
    .run();
};
