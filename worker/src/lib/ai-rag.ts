import type { AiChatMessage, AiConfig, KnowledgeSource, MemoSummary } from '../../../shared/src/types';
import { getAuthorMemoById, listKnowledgeBaseMemos, searchKnowledgeBaseMemosByTerms } from '../db/memo-repository';
import { getMemoOcrText } from '../db/memo-image-ocr-repository';
import type { WorkerBindings } from '../db/client';

const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const INDEX_BATCH_SIZE = 20;
const TOP_K = 20;
const SQL_TOP_K = 20;
const HISTORY_LIMIT = 6;
const SNIPPET_LIMIT = 220;

interface EmbeddingResponse {
  data?: number[][];
}

interface VectorMatch {
  id?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface VectorQueryResponse {
  matches?: VectorMatch[];
}

const ensureKnowledgeBindings = (env: WorkerBindings) => {
  if (!env.AI || !env.VECTORIZE) {
    throw new Error('知识库能力尚未配置，请先在 Cloudflare 绑定 Workers AI 和 Vectorize');
  }
};

const normalizeAiBaseUrl = (url: string) => {
  const trimmed = url.trim().replace(/#.*$/, '').replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('请先配置 AI');
  }
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
};

const createSnippet = (content: string) =>
  content
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SNIPPET_LIMIT);

const buildIndexText = (memo: MemoSummary, ocrText = '') => {
  const tags = memo.tags.length > 0 ? `标签: ${memo.tags.join(', ')}` : '标签: 无';
  return [
    `日期: ${memo.displayDate}`,
    `可见性: ${memo.visibility}`,
    tags,
    '内容:',
    memo.content,
    ocrText ? `图片 OCR:\n${ocrText}` : '',
  ].filter(Boolean).join('\n');
};

const parseEmbedding = (payload: unknown): number[][] => {
  const data = (payload as EmbeddingResponse)?.data;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Embedding 返回格式异常');
  }
  return data;
};

const embedTexts = async (env: WorkerBindings, texts: string[]): Promise<number[][]> => {
  ensureKnowledgeBindings(env);
  const payload = await env.AI!.run(EMBEDDING_MODEL, { text: texts });
  return parseEmbedding(payload);
};

const extractKeywords = (question: string): string[] => {
  const cleaned = question
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:：“”"'`~()[\]{}<>《》]/g, ' ')
    .trim();

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const cjkChunks = cleaned.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const candidates = [...tokens, ...cjkChunks, cleaned]
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  return [...new Set(candidates)].slice(0, 8);
};

const toVectorRecord = (memo: MemoSummary, values: number[]) => ({
  id: String(memo.id),
  values,
  metadata: {
    memoId: memo.id,
    slug: memo.slug,
    visibility: memo.visibility,
    displayDate: memo.displayDate,
  },
});

const coerceSource = async (env: WorkerBindings, match: VectorMatch): Promise<KnowledgeSource | null> => {
  const metadata = match.metadata;
  if (!metadata) {
    return null;
  }

  const memoId = Number(metadata.memoId ?? match.id ?? 0);
  if (!memoId) {
    return null;
  }

  const memo = await getAuthorMemoById(env.DB, memoId);
  if (!memo || memo.deletedAt) {
    return null;
  }

  return {
    memoId,
    slug: memo.slug,
    visibility: memo.visibility,
    displayDate: memo.displayDate,
    score: typeof match.score === 'number' ? match.score : undefined,
    tags: memo.tags,
    snippet: createSnippet(memo.content),
  };
};

export const indexKnowledgeBase = async (env: WorkerBindings): Promise<number> => {
  ensureKnowledgeBindings(env);
  const memos = await listKnowledgeBaseMemos(env.DB);

  for (let i = 0; i < memos.length; i += INDEX_BATCH_SIZE) {
    const batch = memos.slice(i, i + INDEX_BATCH_SIZE);
    const texts = await Promise.all(batch.map(async (memo) => buildIndexText(memo, await getMemoOcrText(env.DB, memo.id))));
    const embeddings = await embedTexts(env, texts);
    await env.VECTORIZE!.upsert(batch.map((memo, idx) => toVectorRecord(memo, embeddings[idx])));
  }

  return memos.length;
};

export const syncMemoToKnowledgeBase = async (env: WorkerBindings, memoId: number): Promise<void> => {
  if (!env.AI || !env.VECTORIZE) {
    return;
  }

  const memo = await getAuthorMemoById(env.DB, memoId);
  if (!memo || memo.deletedAt) {
    await env.VECTORIZE.deleteByIds?.([String(memoId)]);
    return;
  }

  if (memo.visibility !== 'public') {
    await env.VECTORIZE.deleteByIds?.([String(memoId)]);
    return;
  }

  const [embedding] = await embedTexts(env, [buildIndexText(memo, await getMemoOcrText(env.DB, memo.id))]);
  await env.VECTORIZE.upsert([toVectorRecord(memo, embedding)]);
};

export const removeMemoFromKnowledgeBase = async (env: WorkerBindings, memoId: number): Promise<void> => {
  if (!env.VECTORIZE?.deleteByIds) {
    return;
  }
  await env.VECTORIZE.deleteByIds([String(memoId)]);
};

const parseChatCompletion = async (response: Response): Promise<string> => {
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `AI 调用失败 (${response.status})`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('AI 返回为空');
  }
  return content;
};

const createSystemPrompt = (sources: KnowledgeSource[]) => {
  const sourceText = sources.length > 0
    ? sources.map((source, index) => `资料 ${index + 1} | ${source.displayDate} | ${source.visibility} | /memos/${source.slug}\n标签: ${source.tags.join(', ') || '无'}\n内容摘录: ${source.snippet}`).join('\n\n')
    : '没有检索到相关笔记。';

  return [
    '你是我的笔记知识库助手。',
    '请优先依据检索到的笔记回答，不要捏造未出现的事实。',
    '如果资料不足，请明确说不知道，或指出哪些地方需要我补充。',
    '回答默认使用中文简体。',
    '若引用具体笔记，请严格使用下面给出的“资料 N”编号，不要编造不存在的编号。',
    '回答里提到几条资料，必须和实际用到的资料编号对应。',
    '若引用具体笔记，请顺带提及日期或 slug，方便我回看。',
    '',
    '以下是本轮可用的笔记资料：',
    sourceText,
  ].join('\n');
};

const lexicalScore = (memo: MemoSummary, terms: string[]): number => {
  const haystacks = [memo.content, memo.slug, memo.tags.join(' ')];
  let score = 0;

  for (const term of terms) {
    for (const haystack of haystacks) {
      if (haystack.includes(term)) {
        score += haystack === memo.content ? 3 : haystack === memo.slug ? 2 : 4;
      }
    }
  }

  return score;
};

export const chatWithKnowledgeBase = async (
  env: WorkerBindings,
  config: AiConfig,
  question: string,
  history: AiChatMessage[] = [],
): Promise<{ answer: string; sources: KnowledgeSource[] }> => {
  ensureKnowledgeBindings(env);

  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error('问题不能为空');
  }

  const [queryVector] = await embedTexts(env, [trimmed]);
  const vectorPayload = await env.VECTORIZE!.query(queryVector, { topK: TOP_K, returnMetadata: 'all' });
  const rawMatches = (vectorPayload as VectorQueryResponse)?.matches ?? [];
  const semanticHydrated = await Promise.all(rawMatches.map((match) => coerceSource(env, match)));
  const semanticMatches = semanticHydrated.filter((source): source is KnowledgeSource => Boolean(source));

  const keywords = extractKeywords(trimmed);
  const lexicalMemos = await searchKnowledgeBaseMemosByTerms(env.DB, keywords);
  const lexicalMatches: KnowledgeSource[] = lexicalMemos
    .map((memo) => ({
      memoId: memo.id,
      slug: memo.slug,
      visibility: memo.visibility,
      displayDate: memo.displayDate,
      score: lexicalScore(memo, keywords),
      tags: memo.tags,
      snippet: createSnippet(memo.content),
    }))
    .filter((memo) => (memo.score ?? 0) > 0)
    .slice(0, SQL_TOP_K);

  const lexicalIds = new Set(lexicalMatches.map((source) => source.memoId));
  const merged = new Map<number, KnowledgeSource>();

  for (const source of lexicalMatches) {
    merged.set(source.memoId, source);
  }

  const semanticCandidates = lexicalMatches.length > 0
    ? semanticMatches.filter((source) => lexicalIds.has(source.memoId))
    : semanticMatches;

  for (const source of semanticCandidates) {
    const existing = merged.get(source.memoId);
    if (!existing) {
      merged.set(source.memoId, source);
      continue;
    }

    merged.set(source.memoId, {
      ...existing,
      score: Math.max(existing.score ?? 0, source.score ?? 0) + 10,
    });
  }

  const matches = Array.from(merged.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.displayDate.localeCompare(a.displayDate))
    .slice(0, TOP_K);

  const endpoint = normalizeAiBaseUrl(config.url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: createSystemPrompt(matches) },
        ...history.slice(-HISTORY_LIMIT),
        { role: 'user', content: trimmed },
      ],
    }),
  });

  return {
    answer: await parseChatCompletion(response),
    sources: matches,
  };
};
