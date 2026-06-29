export const createOpenApiDocument = () => ({
  openapi: '3.1.0',
  info: {
    title: 'Meno API',
    version: '0.1.0',
    description: 'Stable external API for Meno notes, automation, and clients.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Memos' },
    { name: 'Export' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
    },
    schemas: {
      Memo: {
        type: 'object',
        required: ['id', 'slug', 'content', 'visibility', 'displayDate', 'createdAt', 'updatedAt', 'tags'],
        properties: {
          id: { type: 'integer' },
          slug: { type: 'string' },
          content: { type: 'string' },
          excerpt: { type: 'string' },
          visibility: { type: 'string', enum: ['public', 'private'] },
          displayDate: { type: 'string', format: 'date' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          publishedAt: { type: ['string', 'null'], format: 'date-time' },
          deletedAt: { type: ['string', 'null'], format: 'date-time' },
          pinnedAt: { type: ['string', 'null'], format: 'date-time' },
          favoritedAt: { type: ['string', 'null'], format: 'date-time' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      CreateMemoRequest: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
          visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
          displayDate: { type: 'string', format: 'date' },
        },
      },
      UpdateMemoRequest: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          visibility: { type: 'string', enum: ['public', 'private'] },
          displayDate: { type: 'string', format: 'date' },
        },
      },
      MemoListResponse: {
        type: 'object',
        required: ['memos'],
        properties: {
          memos: {
            type: 'array',
            items: { $ref: '#/components/schemas/Memo' },
          },
        },
      },
      MemoResponse: {
        type: 'object',
        required: ['memo'],
        properties: {
          memo: { $ref: '#/components/schemas/Memo' },
        },
      },
      ExportResponse: {
        type: 'object',
        required: ['version', 'exportedAt', 'memos'],
        properties: {
          version: { type: 'integer' },
          exportedAt: { type: 'string', format: 'date-time' },
          memos: {
            type: 'array',
            items: { $ref: '#/components/schemas/Memo' },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
        },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  paths: {
    '/api/v1/memos': {
      get: {
        tags: ['Memos'],
        operationId: 'listMemos',
        summary: 'List memos',
        parameters: [
          {
            name: 'visibility',
            in: 'query',
            schema: { type: 'string', enum: ['public', 'private', 'all', 'trash'], default: 'public' },
          },
          {
            name: 'date',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
        ],
        responses: {
          '200': { description: 'Memo list', content: { 'application/json': { schema: { $ref: '#/components/schemas/MemoListResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      post: {
        tags: ['Memos'],
        operationId: 'createMemo',
        summary: 'Create a memo',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateMemoRequest' } } },
        },
        responses: {
          '201': { description: 'Created memo', content: { 'application/json': { schema: { $ref: '#/components/schemas/MemoResponse' } } } },
          '400': { description: 'Invalid input', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/v1/memos/{id}': {
      get: {
        tags: ['Memos'],
        operationId: 'getMemo',
        summary: 'Get a memo by numeric id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Memo', content: { 'application/json': { schema: { $ref: '#/components/schemas/MemoResponse' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      patch: {
        tags: ['Memos'],
        operationId: 'updateMemo',
        summary: 'Update a memo',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateMemoRequest' } } },
        },
        responses: {
          '200': { description: 'Updated memo', content: { 'application/json': { schema: { $ref: '#/components/schemas/MemoResponse' } } } },
        },
      },
      delete: {
        tags: ['Memos'],
        operationId: 'deleteMemo',
        summary: 'Move a memo to trash',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Deleted result', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
        },
      },
    },
    '/api/v1/export': {
      get: {
        tags: ['Export'],
        operationId: 'exportMemos',
        summary: 'Export all memos, including trashed memos',
        responses: {
          '200': { description: 'Export bundle', content: { 'application/json': { schema: { $ref: '#/components/schemas/ExportResponse' } } } },
        },
      },
    },
  },
});
