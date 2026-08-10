import { describe, expect, it, vi } from 'vitest';
import type { WorkerBindings } from '../db/client';
import { getMemoKnowledgeSyncQueueJob } from '../db/knowledge-sync-repository';
import worker, { app } from '../index';
import { createTestEnv } from './route-test-helpers';

type TestEnv = Awaited<ReturnType<typeof createTestEnv>>;
type RouteKind = 'upsert' | 'delete';
type RouteRequest = (env: TestEnv, executionContext: ExecutionContext) => Response | Promise<Response>;

interface RouteCase {
  name: string;
  kind: RouteKind;
  targetId?: number;
  expectedStatus: number;
  request: RouteRequest;
  readCreatedId?: (body: unknown) => number;
  assertBody: (body: unknown) => void;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const AUTHOR_HEADERS = {
  ...JSON_HEADERS,
  Cookie: 'meno_session=valid-author-session',
  Origin: 'https://meno.guoyingwei.top',
};
const API_HEADERS = {
  ...JSON_HEADERS,
  'X-API-Key': 'test-api-token',
};

const jsonRequest = (
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) => new Request(url, {
  method,
  headers,
  body: JSON.stringify(body),
});

const invoke = (request: Request, env: TestEnv, executionContext: ExecutionContext) =>
  app.fetch(request, env as WorkerBindings, executionContext);

const readMemo = (body: unknown) => {
  const memo = (body as { memo?: unknown }).memo;
  expect(memo).toBeDefined();
  return memo as { id: number; content: string; visibility: string };
};

const readMemoId = (body: unknown) => Number(readMemo(body).id);

const readMcpMemo = (body: unknown) => {
  const text = (body as {
    result?: { content?: Array<{ text?: unknown }> };
  }).result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(String(text)) as { id: number; content: string; visibility: string };
};

const readMcpMemoId = (body: unknown) => Number(readMcpMemo(body).id);

const expectMemoBody = (content: string) => (body: unknown) => {
  const memo = readMemo(body);
  expect(memo.content).toBe(content);
  expect(memo.visibility).toBe('public');
};

const expectMcpMemoBody = (content: string) => (body: unknown) => {
  const memo = readMcpMemo(body);
  expect(memo.content).toBe(content);
  expect(memo.visibility).toBe('public');
};

const expectDeleteBody = (body: unknown) => {
  expect(body).toEqual({ success: true });
};

const expectMcpDeleteBody = (body: unknown) => {
  const text = String((body as {
    result?: { content?: Array<{ text?: unknown }> };
  }).result?.content?.[0]?.text ?? '');
  expect(text).toContain('moved to trash');
};

const createExecutionContext = () => {
  const tasks: Promise<unknown>[] = [];
  const executionContext = {
    waitUntil(task: Promise<unknown>) {
      tasks.push(task);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { executionContext, tasks };
};

/**
 * Keep the route's own best-effort queue task from consuming the row before
 * the assertion. The actual INSERT still runs against the real D1 adapter;
 * the real Worker scheduled handler is used below to consume the row.
 */
const installQueueProbe = (db: D1Database) => {
  let eventOrder = 0;
  let enqueueCompletedOrder: number | null = null;
  let skippedRouteQueueScan = false;

  const probedDb = {
    prepare(sql: string) {
      const statement = db.prepare(sql);

      if (sql.includes('INSERT INTO knowledge_sync_queue')) {
        return {
          bind(...values: unknown[]) {
            const bound = statement.bind(...values);
            return {
              async run() {
                const result = await bound.run();
                enqueueCompletedOrder = ++eventOrder;
                return result;
              },
            };
          },
        } as unknown as D1PreparedStatement;
      }

      if (
        !skippedRouteQueueScan
        && sql.includes('FROM knowledge_sync_queue')
        && sql.includes('next_retry_at <= ?')
      ) {
        skippedRouteQueueScan = true;
        return {
          bind(..._values: unknown[]) {
            return {
              async all<T = Record<string, unknown>>() {
                return { results: [] as T[] };
              },
            };
          },
        } as unknown as D1PreparedStatement;
      }

      return statement;
    },
    exec(sql: string) {
      return db.exec(sql);
    },
  } as unknown as D1Database;

  return {
    db: probedDb,
    markResponseResolved() {
      return ++eventOrder;
    },
    get enqueueCompletedOrder() {
      return enqueueCompletedOrder;
    },
    get skippedRouteQueueScan() {
      return skippedRouteQueueScan;
    },
  };
};

const installVectorProbe = (env: TestEnv) => {
  const upsertedIds: string[] = [];
  const deletedIds: string[] = [];
  const vectorize = env.VECTORIZE!;
  const originalUpsert = vectorize.upsert;
  const originalDelete = vectorize.deleteByIds;

  (env as WorkerBindings).VECTORIZE = {
    ...vectorize,
    upsert: async (items: unknown[]) => {
      upsertedIds.push(...(items as Array<{ id: string }>).map((item) => String(item.id)));
      return originalUpsert(items);
    },
    deleteByIds: async (ids: string[]) => {
      deletedIds.push(...ids.map(String));
      return originalDelete ? originalDelete(ids) : undefined;
    },
  };

  return { upsertedIds, deletedIds };
};

const routeCases: RouteCase[] = [
  {
    name: '普通 Memo create',
    kind: 'upsert',
    expectedStatus: 201,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/memos', 'POST', AUTHOR_HEADERS, {
        content: 'Route memo create #knowledge-sync',
        visibility: 'public',
        displayDate: '2026-08-10',
      }),
      env,
      executionContext,
    ),
    readCreatedId: readMemoId,
    assertBody: expectMemoBody('Route memo create #knowledge-sync'),
  },
  {
    name: '普通 Memo update',
    kind: 'upsert',
    targetId: 1,
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/memos/1', 'PATCH', AUTHOR_HEADERS, {
        content: 'Route memo update #knowledge-sync',
        visibility: 'public',
      }),
      env,
      executionContext,
    ),
    assertBody: expectMemoBody('Route memo update #knowledge-sync'),
  },
  {
    name: '普通 Memo delete',
    kind: 'delete',
    targetId: 1,
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      new Request('http://localhost/api/memos/1', {
        method: 'DELETE',
        headers: {
          Cookie: 'meno_session=valid-author-session',
          Origin: 'https://meno.guoyingwei.top',
        },
      }),
      env,
      executionContext,
    ),
    assertBody: expectDeleteBody,
  },
  {
    name: 'Quick API POST create',
    kind: 'upsert',
    expectedStatus: 201,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/quick/memos', 'POST', API_HEADERS, {
        content: 'Quick API POST create #knowledge-sync',
        visibility: 'public',
        displayDate: '2026-08-10',
      }),
      env,
      executionContext,
    ),
    readCreatedId: readMemoId,
    assertBody: expectMemoBody('Quick API POST create #knowledge-sync'),
  },
  {
    name: 'Quick API GET create',
    kind: 'upsert',
    expectedStatus: 201,
    request: (env, executionContext) => {
      const query = new URLSearchParams({
        key: 'test-api-token',
        content: 'Quick API GET create #knowledge-sync',
        visibility: 'public',
        display_date: '2026-08-10',
      });
      return invoke(new Request(`http://localhost/api/quick/memos?${query}`), env, executionContext);
    },
    readCreatedId: readMemoId,
    assertBody: expectMemoBody('Quick API GET create #knowledge-sync'),
  },
  {
    name: 'Quick API delete',
    kind: 'delete',
    targetId: 2,
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      new Request('http://localhost/api/quick/memos/public-memo-1', {
        method: 'DELETE',
        headers: { 'X-API-Key': 'test-api-token' },
      }),
      env,
      executionContext,
    ),
    assertBody: expectDeleteBody,
  },
  {
    name: 'V1 create',
    kind: 'upsert',
    expectedStatus: 201,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/v1/memos', 'POST', API_HEADERS, {
        content: 'V1 create #knowledge-sync',
        visibility: 'public',
        displayDate: '2026-08-10',
      }),
      env,
      executionContext,
    ),
    readCreatedId: readMemoId,
    assertBody: expectMemoBody('V1 create #knowledge-sync'),
  },
  {
    name: 'V1 update',
    kind: 'upsert',
    targetId: 1,
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/v1/memos/1', 'PATCH', API_HEADERS, {
        content: 'V1 update #knowledge-sync',
        visibility: 'public',
      }),
      env,
      executionContext,
    ),
    assertBody: expectMemoBody('V1 update #knowledge-sync'),
  },
  {
    name: 'V1 delete',
    kind: 'delete',
    targetId: 1,
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      new Request('http://localhost/api/v1/memos/1', {
        method: 'DELETE',
        headers: { 'X-API-Key': 'test-api-token' },
      }),
      env,
      executionContext,
    ),
    assertBody: expectDeleteBody,
  },
  {
    name: 'MCP create_memo',
    kind: 'upsert',
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/mcp', 'POST', API_HEADERS, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_memo',
          arguments: {
            content: 'MCP create #knowledge-sync',
            visibility: 'public',
          },
        },
      }),
      env,
      executionContext,
    ),
    readCreatedId: readMcpMemoId,
    assertBody: expectMcpMemoBody('MCP create #knowledge-sync'),
  },
  {
    name: 'MCP update_memo',
    kind: 'upsert',
    targetId: 1,
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/mcp', 'POST', API_HEADERS, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'update_memo',
          arguments: {
            id: 1,
            content: 'MCP update #knowledge-sync',
            visibility: 'public',
          },
        },
      }),
      env,
      executionContext,
    ),
    assertBody: expectMcpMemoBody('MCP update #knowledge-sync'),
  },
  {
    name: 'MCP delete_memo',
    kind: 'delete',
    targetId: 1,
    expectedStatus: 200,
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/mcp', 'POST', API_HEADERS, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'delete_memo',
          arguments: { id: 1 },
        },
      }),
      env,
      executionContext,
    ),
    assertBody: expectMcpDeleteBody,
  },
];

const privateRouteCases: Array<{ name: string; request: RouteRequest }> = [
  {
    name: '普通 Memo private create',
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/memos', 'POST', AUTHOR_HEADERS, {
        content: 'Private normal route content must stay private',
        visibility: 'private',
        displayDate: '2026-08-10',
      }),
      env,
      executionContext,
    ),
  },
  {
    name: 'Quick API private create',
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/quick/memos', 'POST', API_HEADERS, {
        content: 'Private Quick route content must stay private',
        visibility: 'private',
        displayDate: '2026-08-10',
      }),
      env,
      executionContext,
    ),
  },
  {
    name: 'Quick API private GET create',
    request: (env, executionContext) => {
      const query = new URLSearchParams({
        key: 'test-api-token',
        content: 'Private Quick GET content must stay private',
        visibility: 'private',
        display_date: '2026-08-10',
      });
      return invoke(new Request(`http://localhost/api/quick/memos?${query}`), env, executionContext);
    },
  },
  {
    name: 'V1 private create',
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/v1/memos', 'POST', API_HEADERS, {
        content: 'Private V1 route content must stay private',
        visibility: 'private',
        displayDate: '2026-08-10',
      }),
      env,
      executionContext,
    ),
  },
  {
    name: 'MCP private create_memo',
    request: (env, executionContext) => invoke(
      jsonRequest('http://localhost/api/mcp', 'POST', API_HEADERS, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_memo',
          arguments: {
            content: 'Private MCP route content must stay private',
            visibility: 'private',
          },
        },
      }),
      env,
      executionContext,
    ),
  },
];

describe('knowledge sync queue route integration', () => {
  it.each(routeCases)('$name enqueues before responding and is processed by scheduled', async (routeCase) => {
    const env = await createTestEnv();
    const vectorProbe = installVectorProbe(env);
    const targetId = routeCase.targetId ?? 1;

    if (routeCase.kind === 'delete') {
      await env.VECTORIZE!.upsert([{ id: String(targetId), values: [1, 2, 3], metadata: { memoId: targetId } }]);
      vectorProbe.upsertedIds.length = 0;
    }

    const queueProbe = installQueueProbe(env.DB);
    env.DB = queueProbe.db;
    const { executionContext, tasks } = createExecutionContext();

    const response = await routeCase.request(env, executionContext);
    const responseResolvedOrder = queueProbe.markResponseResolved();

    expect(response.status).toBe(routeCase.expectedStatus);
    expect(queueProbe.enqueueCompletedOrder).not.toBeNull();
    expect(queueProbe.enqueueCompletedOrder!).toBeLessThan(responseResolvedOrder);

    const body = await response.json();
    routeCase.assertBody(body);
    const memoId = routeCase.readCreatedId ? routeCase.readCreatedId(body) : targetId;
    expect(memoId).toBeGreaterThan(0);

    const queuedJob = await getMemoKnowledgeSyncQueueJob(env.DB, memoId);
    expect(queuedJob).toEqual(expect.objectContaining({
      memoId,
      attemptCount: 0,
      revision: 1,
      lastError: null,
      processingToken: null,
      processingUntil: null,
    }));
    expect(queueProbe.skippedRouteQueueScan).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);

    await Promise.all(tasks);
    await expect(getMemoKnowledgeSyncQueueJob(env.DB, memoId)).resolves.toEqual(expect.objectContaining({ memoId }));

    await worker.scheduled({} as ScheduledEvent, env as WorkerBindings);

    await expect(getMemoKnowledgeSyncQueueJob(env.DB, memoId)).resolves.toBeNull();
    if (routeCase.kind === 'delete') {
      expect(vectorProbe.deletedIds).toContain(String(memoId));
    } else {
      expect(vectorProbe.upsertedIds).toContain(String(memoId));
    }
  });

  it.each(privateRouteCases)('$name never sends private content to a model on route or scheduled paths', async (routeCase) => {
    const env = await createTestEnv();
    const aiRun = vi.spyOn(env.AI!, 'run');
    const vectorProbe = installVectorProbe(env);
    const queueProbe = installQueueProbe(env.DB);
    env.DB = queueProbe.db;
    const { executionContext, tasks } = createExecutionContext();

    const response = await routeCase.request(env, executionContext);
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    const body = await response.json();
    const memo = (body as { memo?: unknown }).memo;
    const createdMemo = memo && typeof memo === 'object' && 'id' in memo
      ? memo as { id: number; visibility: string }
      : readMcpMemo(body);
    expect(createdMemo.visibility).toBe('private');
    expect(createdMemo.id).toBeGreaterThan(0);

    await Promise.all(tasks);
    await worker.scheduled({} as ScheduledEvent, env as WorkerBindings);

    expect(aiRun).not.toHaveBeenCalled();
    expect(vectorProbe.upsertedIds).not.toContain(String(createdMemo.id));
  });
});
