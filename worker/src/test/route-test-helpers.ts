import { applySchema } from '../db/schema';
import { createMemo } from '../db/memo-repository';
import { createTestD1 } from './d1-test-helpers';

export const createTestEnv = async () => {
  const db = createTestD1();
  applySchema(db);

  await createMemo(db, {
    slug: 'public-memo-2',
    content: 'Second public memo #serverless',
    visibility: 'public',
    displayDate: '2026-03-24',
  });

  await createMemo(db, {
    slug: 'public-memo-1',
    content: 'First public memo #cloudflare #meno',
    visibility: 'public',
    displayDate: '2026-03-24',
  });

  await createMemo(db, {
    slug: 'private-memo-1',
    content: 'Private memo #private-note',
    visibility: 'private',
    displayDate: '2026-03-23',
  });

  await createMemo(db, {
    slug: 'draft-memo-1',
    content: 'Draft memo #draft-note',
    visibility: 'draft',
    displayDate: '2026-03-22',
  });

  const objects = new Map<string, ArrayBuffer>();
  const bucket = {
    put: async (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null) => {
      if (value instanceof ArrayBuffer) {
        objects.set(key, value);
      }
      return { key } as R2Object;
    },
  } as unknown as R2Bucket;

  return {
    DB: db,
    ASSETS: bucket,
    APP_ORIGIN: 'https://meno.guoyingwei.top',
    API_ORIGIN: 'https://api.meno.guoyingwei.top',
    ASSET_PUBLIC_BASE_URL: 'https://api.meno.guoyingwei.top/api/assets',
    GITHUB_ALLOWED_LOGIN: 'guoyingwei6',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    SESSION_SECRET: 'test-secret',
  };
};
