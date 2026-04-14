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

  const objects = new Map<string, ArrayBuffer>();
  const vectors = new Map<string, { values: number[]; metadata?: Record<string, unknown> }>();
  const bucket = {
    put: async (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null) => {
      if (value instanceof ArrayBuffer) {
        objects.set(key, value);
      }
      return { key } as R2Object;
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
    get: async (key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) => {
      const value = objects.get(key);
      if (!value) {
        return null;
      }

      let output = value;
      const range = options?.range;
      if (range) {
        if (typeof range.suffix === 'number') {
          output = value.slice(Math.max(value.byteLength - range.suffix, 0));
        } else {
          const offset = range.offset ?? 0;
          const length = range.length ?? value.byteLength - offset;
          output = value.slice(offset, offset + length);
        }
      }

      return {
        arrayBuffer: async () => output,
        body: new Blob([output]).stream(),
        httpEtag: 'test-etag',
        writeHttpMetadata: (headers: Headers) => {
          headers.set('content-type', key.endsWith('.m4a') ? 'audio/mp4' : 'image/png');
        },
      } as unknown as R2ObjectBody;
    },
    list: async ({ prefix }: { prefix?: string } = {}) => ({
      objects: Array.from(objects.keys())
        .filter((key) => (prefix ? key.startsWith(prefix) : true))
        .map((key) => ({ key })),
    }),
  } as unknown as R2Bucket;

  const ai = {
    run: async (_model: string, input: unknown) => {
      const texts = (input as { text?: string[] })?.text ?? [];
      return {
        data: texts.map((text, index) => [text.length, index + 1, text.includes('private') ? 2 : 1]),
      };
    },
    toMarkdown: async () => ({
      format: 'markdown',
      data: '图片中的测试文字',
    }),
  };

  const vectorize = {
    upsert: async (items: unknown[]) => {
      const typedItems = items as Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>;
      for (const item of typedItems) {
        vectors.set(item.id, { values: item.values, metadata: item.metadata });
      }
      return { count: typedItems.length };
    },
    query: async (_vector: number[], _options?: Record<string, unknown>) => ({
      matches: Array.from(vectors.entries()).map(([id, entry], index) => ({
        id,
        score: 1 - index * 0.1,
        metadata: entry.metadata,
      })),
    }),
    deleteByIds: async (ids: string[]) => {
      for (const id of ids) {
        vectors.delete(id);
      }
      return { count: ids.length };
    },
  };

  return {
    DB: db,
    ASSETS: bucket,
    AI: ai,
    VECTORIZE: vectorize,
    APP_ORIGIN: 'https://meno.guoyingwei.top',
    API_ORIGIN: 'https://api.meno.guoyingwei.top',
    ASSET_PUBLIC_BASE_URL: 'https://api.meno.guoyingwei.top/api/assets',
    OCR_DAILY_LIMIT: '20',
    OCR_BATCH_SIZE: '5',
    OCR_SEED_BATCH_SIZE: '10',
    GITHUB_ALLOWED_LOGIN: 'guoyingwei6',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    SESSION_SECRET: 'test-secret',
  };
};
