import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { MemoSummary } from '../../../shared/src/types';
import { app } from '../index';
import { createMemo } from '../db/memo-repository';
import { applySchema } from '../db/schema';
import { createTestD1 } from './d1-test-helpers';

const PAGE_SIZE = 20;
const TOTAL_MEMOS = 120;
const WARMUP_ROUNDS = 3;
const MEASURE_ROUNDS = 25;
const RELATION_CHUNK_SIZE = 99;
const LONG_BODY_TOKEN_COUNT = 360;
const FULL_BODY_TAIL_MARKER = 'feed-budget-full-body-tail';

interface FeedPayload {
  memos: MemoSummary[];
  nextCursor?: string | null;
}

interface FeedMeasurement {
  itemCount: number;
  statementCount: number;
  bodyBytes: number;
  gzipBytes: number;
  localHandlerMs: {
    min: number;
    p50: number;
    p75: number;
    max: number;
  };
}

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
};

const observeStatements = (database: D1Database) => {
  let statementCount = 0;

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === 'bind') {
        return (...values: unknown[]) => {
          const bind = value as (...args: unknown[]) => D1PreparedStatement;
          return wrapStatement(bind.apply(target, values));
        };
      }
      if (property === 'all' || property === 'first' || property === 'run' || property === 'raw') {
        return (...args: unknown[]) => {
          statementCount += 1;
          const execute = value as (...executeArgs: unknown[]) => unknown;
          return execute.apply(target, args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const observed = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => wrapStatement(target.prepare(sql));
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return {
    db: observed as D1Database,
    get statementCount() {
      return statementCount;
    },
  };
};

const createFixture = async (): Promise<D1Database> => {
  const db = createTestD1();
  applySchema(db);

  for (let index = 0; index < TOTAL_MEMOS; index += 1) {
    const stableTokens = Array.from({ length: LONG_BODY_TOKEN_COUNT }, (_, tokenIndex) => {
      const value = ((index + 11) * (tokenIndex + 23) * 2654435761) >>> 0;
      return `entry-${index}-${tokenIndex}-${value.toString(36)}`;
    }).join(' ');
    const slug = `feed-response-budget-${String(index).padStart(3, '0')}`;
    await createMemo(db, {
      slug,
      content: `Local feed response budget fixture ${index}. ${stableTokens} #feed/benchmark #topic/${index % 6}\n${FULL_BODY_TAIL_MARKER}-${index}`,
      visibility: 'public',
      displayDate: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    });
    const timestamp = new Date(Date.UTC(2026, 7, 10, 0, index, 0)).toISOString();
    await db
      .prepare('UPDATE memos SET created_at = ?, updated_at = ?, published_at = ? WHERE slug = ?')
      .bind(timestamp, timestamp, timestamp, slug)
      .run();
  }

  return db;
};

const requestFeed = async (database: D1Database, query: string): Promise<{ measurement: Omit<FeedMeasurement, 'localHandlerMs'>; handlerMs: number }> => {
  const observed = observeStatements(database);
  const env = {
    DB: observed.db,
    ASSETS: {} as R2Bucket,
    APP_ORIGIN: 'http://localhost:5173',
    API_ORIGIN: 'http://localhost:8787',
    ASSET_PUBLIC_BASE_URL: 'http://localhost:8787/api/assets',
    GITHUB_ALLOWED_LOGIN: 'local-test',
    GITHUB_CLIENT_ID: 'local-test',
    GITHUB_CLIENT_SECRET: 'local-test',
    SESSION_SECRET: 'local-test',
  };
  const startedAt = performance.now();
  const response = await app.request(`http://localhost/api/public/memos${query}`, {}, env);
  const handlerMs = performance.now() - startedAt;
  const body = await response.text();
  const payload = JSON.parse(body) as FeedPayload;

  expect(response.status).toBe(200);
  expect(Array.isArray(payload.memos)).toBe(true);
  expect(payload.memos.every((memo) => (
    memo.contentTruncated === true
    && typeof memo.contentCharacterCount === 'number'
    && memo.contentCharacterCount > Array.from(memo.content).length
    && !memo.content.includes(FULL_BODY_TAIL_MARKER)
  ))).toBe(true);

  const bodyBytes = Buffer.byteLength(body, 'utf8');
  const gzipBytes = gzipSync(Buffer.from(body, 'utf8')).byteLength;

  return {
    measurement: {
      itemCount: payload.memos.length,
      statementCount: observed.statementCount,
      bodyBytes,
      gzipBytes,
    },
    handlerMs,
  };
};

const measureFeed = async (database: D1Database, query: string, expectedItems: number): Promise<FeedMeasurement> => {
  for (let index = 0; index < WARMUP_ROUNDS; index += 1) {
    await requestFeed(database, query);
  }

  const samples: number[] = [];
  let lastMeasurement: Omit<FeedMeasurement, 'localHandlerMs'> | undefined;
  for (let index = 0; index < MEASURE_ROUNDS; index += 1) {
    const result = await requestFeed(database, query);
    samples.push(result.handlerMs);
    lastMeasurement = result.measurement;
  }

  expect(lastMeasurement).toBeDefined();
  expect(lastMeasurement?.itemCount).toBe(expectedItems);
  expect(lastMeasurement?.statementCount).toBe(1 + 2 * Math.ceil(expectedItems === PAGE_SIZE ? PAGE_SIZE / RELATION_CHUNK_SIZE : TOTAL_MEMOS / RELATION_CHUNK_SIZE));

  return {
    ...(lastMeasurement as Omit<FeedMeasurement, 'localHandlerMs'>),
    localHandlerMs: {
      min: Number(Math.min(...samples).toFixed(3)),
      p50: Number(percentile(samples, 0.5).toFixed(3)),
      p75: Number(percentile(samples, 0.75).toFixed(3)),
      max: Number(Math.max(...samples).toFixed(3)),
    },
  };
};

describe('feed response budget evidence', () => {
  it('measures 20-item and full-feed statements, JSON, gzip, and local handler timing', async () => {
    const db = await createFixture();
    const page = await measureFeed(db, `?limit=${PAGE_SIZE}`, PAGE_SIZE);
    const full = await measureFeed(db, '', TOTAL_MEMOS);

    expect(page.gzipBytes).toBeLessThan(page.bodyBytes);
    expect(page.gzipBytes).toBeLessThan(15 * 1024);
    expect(full.gzipBytes).toBeLessThan(full.bodyBytes);
    expect(full.itemCount).toBe(TOTAL_MEMOS);
    expect(full.bodyBytes).toBeGreaterThan(page.bodyBytes);
    expect(full.gzipBytes).toBeGreaterThan(page.gzipBytes);

    console.log(JSON.stringify({
      fixture: {
        totalMemos: TOTAL_MEMOS,
        pageSize: PAGE_SIZE,
        measuredRounds: MEASURE_ROUNDS,
        warmupRounds: WARMUP_ROUNDS,
        relationChunkSize: RELATION_CHUNK_SIZE,
        longBodyTokenCount: LONG_BODY_TOKEN_COUNT,
      },
      note: 'localHandlerMs measures app.request resolution, a local TTFB proxy; it excludes remote network and Cloudflare edge overhead',
      page20: page,
      fullFeed: full,
    }, null, 2));
  });
});
