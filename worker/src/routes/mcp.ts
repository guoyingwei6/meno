import { Hono } from 'hono';
import {
  createMemoWithOutcome,
  getMemoByClientId,
  getAuthorMemoBySlug,
  listAuthorMemos,
  normalizeClientId,
  searchAuthorMemos,
  trashMemo,
  updateMemo,
} from '../db/memo-repository';
import type { WorkerBindings } from '../db/client';
import { isApiKeyValid } from '../lib/auth';
import { createMemoSlug } from '../lib/slug';
import { markMemoImageOcrRemovedByMemo, syncMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { mirrorExternalImages } from '../lib/asset-mirroring';
import { enqueueMemoKnowledgeSync, scheduleMemoKnowledgeSync } from '../lib/knowledge-sync-queue';

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
    description: 'Create a new memo. Use #tag in content to add tags. Pass image URLs in images array to attach photos.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Memo content (markdown). Tags must use # prefix in text, e.g. "想法 #读书 #技术"' },
        visibility: {
          type: 'string',
          enum: ['public', 'private'],
          description: 'Visibility (default: public)',
        },
        displayDate: { type: 'string', description: 'Display date (YYYY-MM-DD, default: today)' },
        images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of image URLs to attach. Images are mirrored to storage and appended as markdown.',
        },
        client_id: { type: 'string', description: 'Stable client id for idempotent retries (1-128 chars).' },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_memo',
    description: 'Update an existing memo by ID. To add/change tags, include #tag in the content text (e.g. "my note #reading #tech"). Tags are parsed from # prefixed words in the content. When updating content, provide the FULL content (not just the tags to add).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Memo ID' },
        content: { type: 'string', description: 'Full new content (replaces old content entirely). Use #tag for tags, e.g. "想法 #读书 #技术"' },
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
type ScheduleTask = (task: Promise<void>) => void;

const toolHandlers: Record<
  string,
  (env: WorkerBindings, args: Record<string, unknown>, schedule?: ScheduleTask) => Promise<ToolResult>
> = {
  async list_memos(env, args) {
    const db = env.DB;
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

  async get_memo(env, args) {
    const db = env.DB;
    const slug = args.slug as string;
    const memo = await getAuthorMemoBySlug(db, slug);
    if (!memo) {
      return { content: [{ type: 'text', text: 'Memo not found' }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }] };
  },

  async create_memo(env, args, schedule = (task) => { void task; }) {
    const db = env.DB;
    const clientId = normalizeClientId(args.client_id);
    if (clientId) {
      const existing = await getMemoByClientId(db, clientId);
      if (existing) {
        await enqueueMemoKnowledgeSync(db, existing.id);
        scheduleMemoKnowledgeSync(env, existing.id, schedule);
        return { content: [{ type: 'text', text: JSON.stringify(existing, null, 2) }] };
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const displayDate =
      args.displayDate && /^\d{4}-\d{2}-\d{2}$/.test(args.displayDate as string)
        ? (args.displayDate as string)
        : today;

    let content = args.content as string;
    const imageUrls = args.images as string[] | undefined;
    if (imageUrls && imageUrls.length > 0) {
      const mirrored = await mirrorExternalImages(env, imageUrls);
      if (mirrored.length > 0) {
        const imgMarkdown = mirrored.map(({ url }) => `![](${url})`).join('\n');
        content = content ? `${content}\n${imgMarkdown}` : imgMarkdown;
      }
    }

    const outcome = await createMemoWithOutcome(db, {
      slug: createMemoSlug(),
      content,
      visibility: (args.visibility as 'public' | 'private') || 'public',
      displayDate,
      clientId,
    });
    const memo = outcome.memo;
    if (outcome.created) {
      schedule(syncMemoImageOcrTasks(db, memo.id, memo.content, memo.visibility));
    }
    await enqueueMemoKnowledgeSync(db, memo.id);
    scheduleMemoKnowledgeSync(env, memo.id, schedule);
    return { content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }] };
  },

  async update_memo(env, args, schedule = (task) => { void task; }) {
    const db = env.DB;
    const id = args.id as number;
    const input: { content?: string; visibility?: 'public' | 'private'; displayDate?: string } = {};
    if (args.content !== undefined) input.content = args.content as string;
    if (args.visibility !== undefined) input.visibility = args.visibility as 'public' | 'private';
    if (args.displayDate !== undefined) input.displayDate = args.displayDate as string;

    const memo = await updateMemo(db, id, input);
    if (!memo) {
      return { content: [{ type: 'text', text: 'Memo not found' }], isError: true };
    }
    if (input.content !== undefined || input.visibility !== undefined) {
      schedule(syncMemoImageOcrTasks(db, memo.id, memo.content, memo.visibility));
    }
    await enqueueMemoKnowledgeSync(db, memo.id);
    scheduleMemoKnowledgeSync(env, memo.id, schedule);
    return { content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }] };
  },

  async delete_memo(env, args, schedule = (task) => { void task; }) {
    const db = env.DB;
    const id = args.id as number;
    const deleted = await trashMemo(db, id);
    if (!deleted) {
      return { content: [{ type: 'text', text: 'Memo not found' }], isError: true };
    }
    schedule(markMemoImageOcrRemovedByMemo(db, id));
    await enqueueMemoKnowledgeSync(db, id);
    scheduleMemoKnowledgeSync(env, id, schedule);
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

const handleMcpRequest = async (env: WorkerBindings, req: JsonRpcRequest, schedule: ScheduleTask = (task) => { void task; }) => {
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
        const result = await handler(env, toolArgs, schedule);
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
  c.header('Cache-Control', 'private, no-store');
  await next();
});

// --- POST: main JSON-RPC endpoint (Streamable HTTP) ---

mcpRoutes.post('/', async (c) => {
  const body = await c.req.json<JsonRpcRequest>();

  if (body.jsonrpc !== '2.0' || !body.method) {
    return c.json(jsonRpcError(body.id, -32600, 'Invalid JSON-RPC request'), 400);
  }

  const isNotification = body.id === undefined;
  const schedule: ScheduleTask = (task) => {
    const safeTask = task.catch((error) => {
      console.error('MCP background task failed', error);
    });
    try {
      const waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
      if (waitUntil) {
        waitUntil(safeTask);
        return;
      }
    } catch {
      // Local test adapters do not provide an execution context.
    }
    void safeTask;
  };

  // Handle initialize: create session
  if (body.method === 'initialize') {
    const sessionId = generateSessionId();
    activeSessions.add(sessionId);
    const result = await handleMcpRequest(c.env, body, schedule);
    return c.json(result, 200, { 'Mcp-Session-Id': sessionId });
  }

  const result = await handleMcpRequest(c.env, body, schedule);

  // Notifications get 202 Accepted with no body
  if (result === null) {
    return c.body(null, 202);
  }

  return c.json(result);
});

// --- GET: server-to-client SSE stream ---
// Streamable HTTP clients open a GET after initialization to receive
// server-initiated messages.  We keep the stream open (idle) so the
// MCP SDK's handle_get_stream doesn't treat a 405 as a fatal error.

mcpRoutes.get('/', async (c) => {
  const sessionId = c.req.header('Mcp-Session-Id');
  if (!sessionId || !activeSessions.has(sessionId)) {
    return c.body(null, 400);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send an initial comment to keep the connection alive, then hold open.
  writer.write(encoder.encode(': ok\n\n'));

  // Cloudflare Workers will terminate long-lived streams when the client
  // disconnects, so we don't need an explicit close timer.

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

// --- DELETE: session termination ---

mcpRoutes.delete('/', async (c) => {
  const sessionId = c.req.header('Mcp-Session-Id');
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
  return c.body(null, 204);
});
