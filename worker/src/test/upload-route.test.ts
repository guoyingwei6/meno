import { describe, expect, it } from 'vitest';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('POST /api/upload-url', () => {
  it('rejects unauthenticated upload requests', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filename: 'image.png', contentType: 'image/png' }),
    }, env);

    expect(response.status).toBe(401);
  });

  it('returns an upload target for the author session', async () => {
    const env = await createTestEnv();
    const response = await app.request('http://localhost/api/upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
      },
      body: JSON.stringify({ filename: 'image.png', contentType: 'image/png' }),
    }, env);

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toEqual({
      uploadUrl: expect.stringContaining('/uploads/'),
      objectKey: expect.stringMatching(/^uploads\/\d{4}\/\d{2}\/\d{14}\d{3}\.png$/),
    });
  });
});
