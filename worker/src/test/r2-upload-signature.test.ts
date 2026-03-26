import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

interface UploadPayload {
  uploadUrl: string;
  objectKey: string;
}

describe('R2 upload target route', () => {
  it('returns an upload target using the configured asset origin', async () => {
    const env = await createTestEnv();
    env.ASSET_PUBLIC_BASE_URL = 'https://cdn.example.com';

    const response = await app.request(
      'http://localhost/api/upload-url',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'meno_session=valid-author-session',
        },
        body: JSON.stringify({ filename: 'hello.png', contentType: 'image/png' }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as UploadPayload;
    expect(payload.uploadUrl).toContain('https://cdn.example.com/uploads/');
    expect(payload.objectKey).toMatch(/^uploads\/\d{4}\/\d{2}\/\d{14}\d{3}\.png$/);
  });
});
