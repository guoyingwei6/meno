import { describe, expect, it } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

type McpResponseBody = {
  result: {
    serverInfo: { name: string };
    protocolVersion: string;
    capabilities: { tools: unknown };
    tools: Array<{ name: string }>;
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  error: {
    code: number;
  };
};

const readMcpBody = async (response: Response) => response.json() as Promise<McpResponseBody>;

const testEnv = (env: Awaited<ReturnType<typeof createTestEnv>>) => ({
  ...env,
  API_TOKEN: 'test-api-token',
});

const mcpRequest = async (
  env: Awaited<ReturnType<typeof createTestEnv>>,
  method: string,
  params?: Record<string, unknown>,
  options?: { token?: string; id?: string | number | undefined },
) => {
  const token = options?.token ?? 'test-api-token';
  const id = options?.id !== undefined ? options.id : 1;
  const body: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (id !== undefined) body.id = id;
  if (params !== undefined) body.params = params;

  return app.request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': token,
    },
    body: JSON.stringify(body),
  }, testEnv(env));
};

describe('MCP endpoint', () => {
  it('rejects requests without valid API token', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'initialize', undefined, { token: 'wrong-token' });
    expect(res.status).toBe(401);
  });

  it('handles initialize and returns Mcp-Session-Id', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'initialize');
    expect(res.status).toBe(200);
    expect(res.headers.get('Mcp-Session-Id')).toBeTruthy();
    const body = await readMcpBody(res);
    expect(body.result.serverInfo.name).toBe('meno-mcp');
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('notifications/initialized returns 202', async () => {
    const env = await createTestEnv();
    // Notifications have no id
    const res = await app.request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-api-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    }, testEnv(env));
    expect(res.status).toBe(202);
  });

  it('lists available tools', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/list');
    const body = await readMcpBody(res);
    const toolNames = body.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(['list_memos', 'get_memo', 'create_memo', 'update_memo', 'delete_memo']);
  });

  it('list_memos returns all memos', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/call', {
      name: 'list_memos',
      arguments: {},
    });
    const body = await readMcpBody(res);
    const memos = JSON.parse(body.result.content[0].text);
    expect(memos.length).toBe(3);
  });

  it('list_memos filters by tag', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/call', {
      name: 'list_memos',
      arguments: { tag: 'cloudflare' },
    });
    const body = await readMcpBody(res);
    const memos = JSON.parse(body.result.content[0].text);
    expect(memos.length).toBe(1);
    expect(memos[0].tags).toContain('cloudflare');
  });

  it('list_memos searches by query', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/call', {
      name: 'list_memos',
      arguments: { query: 'Private' },
    });
    const body = await readMcpBody(res);
    const memos = JSON.parse(body.result.content[0].text);
    expect(memos.length).toBe(1);
  });

  it('get_memo returns memo by slug', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/call', {
      name: 'get_memo',
      arguments: { slug: 'public-memo-1' },
    });
    const body = await readMcpBody(res);
    const memo = JSON.parse(body.result.content[0].text);
    expect(memo.slug).toBe('public-memo-1');
    expect(memo.content).toContain('First public memo');
  });

  it('get_memo returns error for unknown slug', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/call', {
      name: 'get_memo',
      arguments: { slug: 'nonexistent' },
    });
    const body = await readMcpBody(res);
    expect(body.result.isError).toBe(true);
  });

  it('create_memo creates a new memo', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/call', {
      name: 'create_memo',
      arguments: {
        content: 'New MCP memo #test',
        visibility: 'private',
      },
    });
    const body = await readMcpBody(res);
    const memo = JSON.parse(body.result.content[0].text) as MemoDetail;
    expect(memo.content).toBe('New MCP memo #test');
    expect(memo.visibility).toBe('private');
    expect(memo.tags).toContain('test');
  });

  it('update_memo updates memo content', async () => {
    const env = await createTestEnv();
    const listRes = await mcpRequest(env, 'tools/call', {
      name: 'list_memos',
      arguments: {},
    });
    const listBody = await readMcpBody(listRes);
    const memos = JSON.parse(listBody.result.content[0].text);
    const id = memos[0].id;

    const res = await mcpRequest(env, 'tools/call', {
      name: 'update_memo',
      arguments: { id, content: 'Updated content #updated' },
    });
    const body = await readMcpBody(res);
    const memo = JSON.parse(body.result.content[0].text) as MemoDetail;
    expect(memo.content).toBe('Updated content #updated');
    expect(memo.tags).toContain('updated');
  });

  it('delete_memo trashes a memo', async () => {
    const env = await createTestEnv();
    const listRes = await mcpRequest(env, 'tools/call', {
      name: 'list_memos',
      arguments: {},
    });
    const listBody = await readMcpBody(listRes);
    const memos = JSON.parse(listBody.result.content[0].text);
    const id = memos[0].id;

    const res = await mcpRequest(env, 'tools/call', {
      name: 'delete_memo',
      arguments: { id },
    });
    const body = await readMcpBody(res);
    expect(body.result.content[0].text).toContain('moved to trash');

    const listRes2 = await mcpRequest(env, 'tools/call', {
      name: 'list_memos',
      arguments: {},
    });
    const listBody2 = await readMcpBody(listRes2);
    const remaining = JSON.parse(listBody2.result.content[0].text);
    expect(remaining.length).toBe(2);
  });

  it('returns error for unknown tool', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/call', {
      name: 'nonexistent_tool',
      arguments: {},
    });
    const body = await readMcpBody(res);
    expect(body.error.code).toBe(-32602);
  });

  it('returns error for unknown method', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'tools/list_changed');
    const body = await readMcpBody(res);
    expect(body.error.code).toBe(-32601);
  });

  it('GET returns SSE stream with valid session', async () => {
    const env = await createTestEnv();
    // First initialize to get a session ID
    const initRes = await mcpRequest(env, 'initialize');
    const sessionId = initRes.headers.get('Mcp-Session-Id')!;

    const res = await app.request('http://localhost/api/mcp', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-api-token', 'Mcp-Session-Id': sessionId },
    }, testEnv(env));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('GET returns 400 without valid session', async () => {
    const env = await createTestEnv();
    const res = await app.request('http://localhost/api/mcp', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-api-token' },
    }, testEnv(env));
    expect(res.status).toBe(400);
  });

  it('handles DELETE for session termination', async () => {
    const env = await createTestEnv();
    const res = await app.request('http://localhost/api/mcp', {
      method: 'DELETE',
      headers: {
        'X-API-Key': 'test-api-token',
        'Mcp-Session-Id': 'some-session-id',
      },
    }, testEnv(env));
    expect(res.status).toBe(204);
  });

  it('handles ping', async () => {
    const env = await createTestEnv();
    const res = await mcpRequest(env, 'ping');
    const body = await readMcpBody(res);
    expect(body.result).toEqual({});
  });
});
