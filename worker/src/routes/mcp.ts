import { Hono } from 'hono';
import {
  createMemo,
  getAuthorMemoBySlug,
  listAuthorMemos,
  searchAuthorMemos,
  trashMemo,
  updateMemo,
} from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { isApiKeyValid } from '../lib/auth';
import { createMemoSlug } from '../lib/slug';
import { syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';

export const mcpRoutes = new Hono<{ Bindings: WorkerBindings }>();

// --- MCP Tool definitions ---

const TOOLS = [
  {
    name: 'list_memos',
    description: 'List memos with optional filters. Returns an array of memo summaries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tag: { type: 'string', description: 'Filter by tag' },
        date: { type: 'string', description: 'Filter by date (YYYY-MM-DD)' },
        query: { type: 'string', description: 'Search memos by keyword' },
        view: {
          type: 'string',
          enum: ['all', 'public', 'private', 'trash', 'favorited'],
          description: 'View filter (default: all)',
        },
      },
    },
  },
  {
    name: 'get_memo',
    description: 'Get a single memo by its slug. Returns full memo detail.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'The memo slug' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'create_memo',
    description: 'Create a new memo. Use #tag in content to add tags.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Memo content (markdown). Use #tag for tags.' },
        visibility: {
          type: 'string',
          enum: ['public', 'private'],
          description: 'Visibility (default: public)',
        },
        displayDate: { type: 'string', description: 'Display date (YYYY-MM-DD, default: today)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_memo',
    description: 'Update an existing memo by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Memo ID' },
        content: { type: 'string', description: 'New content' },
        visibility: { type: 'string', enum: ['public', 'private'], description: 'New visibility' },
        displayDate: { type: 'string', description: 'New display date (YYYY-MM-DD)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_memo',
    description: 'Move a memo to trash by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Memo ID' },
      },
      required: ['id'],
    },
  },
];

// --- Tool handlers ---

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const toolHandlers: Record<
  string,
  (db: D1Database, args: Record<string, unknown>) => Promise<ToolResult>
> = {
  async list_memos(db, args) {
    const query = args.query as string | undefined;
    let memos;
    if (query) {
      memos = await searchAuthorMemos(db, query);
    } else {
      memos = await listAuthorMemos(db, {
        view: (args.view as 'all' | 'public' | 'private' | 'trash' | 'favorited') || 'all',
        date: args.date as string | undefined,
      });
    }

    if (args.tag) {
      const tag = args.tag as string;
      memos = memos.filter((m) => m.tags.includes(tag));
    }

    const summary = memos.map((m) => ({
      id: m.id,
      slug: m.slug,
      excerpt: m.excerpt.slice(0, 200),
      visibility: m.visibility,
      displayDate: m.displayDate,
      tags: m.tags,
      pinnedAt: m.pinnedAt,
      favoritedAt: m.favoritedAt,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  },

  async get_memo(db, args) {
    const slug = args.slug as string;
    const memo = await getAuthorMemoBySlug(db, slug);
    if (!memo) {
      return { content: [{ type: 'text', text: 'Memo not found' }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }] };
  },

  async create_memo(db, args) {
    const today = new Date().toISOString().slice(0, 10);
    const displayDate =
      args.displayDate && /^\d{4}-\d{2}-\d{2}$/.test(args.displayDate as string)
        ? (args.displayDate as string)
        : today;

    const memo = await createMemo(db, {
      slug: createMemoSlug(),
      content: args.content as string,
      visibility: (args.visibility as 'public' | 'private') || 'public',
      displayDate,
    });
    await syncMemoImageOcrTasks(db, memo.id, memo.content, memo.visibility);
    return { content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }] };
  },

  async update_memo(db, args) {
    const id = args.id as number;
    const input: { content?: string; visibility?: 'public' | 'private'; displayDate?: string } = {};
    if (args.content !== undefined) input.content = args.content as string;
    if (args.visibility !== undefined) input.visibility = args.visibility as 'public' | 'private';
    if (args.displayDate !== undefined) input.displayDate = args.displayDate as string;

    const memo = await updateMemo(db, id, input);
    if (!memo) {
      return { content: [{ type: 'text', text: 'Memo not found' }], isError: true };
    }
    if (input.content !== undefined) {
      await syncMemoImageOcrTasks(db, memo.id, memo.content, memo.visibility);
    }
    return { content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }] };
  },

  async delete_memo(db, args) {
    const id = args.id as number;
    const deleted = await trashMemo(db, id);
    if (!deleted) {
      return { content: [{ type: 'text', text: 'Memo not found' }], isError: true };
    }
    return { content: [{ type: 'text', text: `Memo ${id} moved to trash` }] };
  },
};

// --- JSON-RPC helpers ---

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const jsonRpcSuccess = (id: string | number | undefined, result: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  result,
});

const jsonRpcError = (id: string | number | undefined, code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message },
});

// --- Session management ---

const generateSessionId = () => crypto.randomUUID();

// Active sessions (in-memory; resets on Worker restart, which is fine for stateless MCP)
const activeSessions = new Set<string>();

// --- MCP protocol handler ---

const SERVER_INFO = {
  name: 'meno-mcp',
  version: '1.0.0',
};

const handleMcpRequest = async (db: D1Database, req: JsonRpcRequest) => {
  const isNotification = req.id === undefined;

  switch (req.method) {
    case 'initialize':
      return jsonRpcSuccess(req.id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return jsonRpcSuccess(req.id, { tools: TOOLS });

    case 'tools/call': {
      const params = req.params ?? {};
      const toolName = params.name as string;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const handler = toolHandlers[toolName];
      if (!handler) {
        return jsonRpcError(req.id, -32602, `Unknown tool: ${toolName}`);
      }
      try {
        const result = await handler(db, toolArgs);
        return jsonRpcSuccess(req.id, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal error';
        return jsonRpcSuccess(req.id, {
          content: [{ type: 'text', text: message }],
          isError: true,
        });
      }
    }

    case 'ping':
      return jsonRpcSuccess(req.id, {});

    default:
      if (isNotification) return null;
      return jsonRpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
};

// --- Auth middleware ---

mcpRoutes.use('/*', async (c, next) => {
  if (!isApiKeyValid(c.env, c.req.raw)) {
    return c.json({ message: 'Unauthorized' }, 401);
  }
  await next();
});

// --- POST: main JSON-RPC endpoint (Streamable HTTP) ---

mcpRoutes.post('/', async (c) => {
  const body = await c.req.json<JsonRpcRequest>();

  if (body.jsonrpc !== '2.0' || !body.method) {
    return c.json(jsonRpcError(body.id, -32600, 'Invalid JSON-RPC request'), 400);
  }

  const isNotification = body.id === undefined;

  // Handle initialize: create session
  if (body.method === 'initialize') {
    const sessionId = generateSessionId();
    activeSessions.add(sessionId);
    const result = await handleMcpRequest(c.env.DB, body);
    return c.json(result, 200, { 'Mcp-Session-Id': sessionId });
  }

  const result = await handleMcpRequest(c.env.DB, body);

  // Notifications get 202 Accepted with no body
  if (result === null) {
    return c.body(null, 202);
  }

  return c.json(result);
});

// --- GET: server-to-client SSE (not supported on Cloudflare Workers) ---

mcpRoutes.get('/', async (c) => {
  // MCP spec: servers that do not support server-initiated SSE SHOULD return 405
  return c.body(null, 405);
});

// --- DELETE: session termination ---

mcpRoutes.delete('/', async (c) => {
  const sessionId = c.req.header('Mcp-Session-Id');
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  return c.body(null, 204);
});
