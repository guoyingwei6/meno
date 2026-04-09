import type { OcrQueueStatus } from '../../../shared/src/types';
import { claimPendingMemoImageOcrTasks, countMemoImageOcrProcessedOn, getMemoImageOcrQueueCounts, markMemoImageOcrDone, markMemoImageOcrFailed, seedMissingMemoImageOcrTasks } from '../db/memo-image-ocr-repository';
import { syncMemoToKnowledgeBase } from './ai-rag';
import type { WorkerBindings } from '../db/client';

const DEFAULT_OCR_DAILY_LIMIT = 20;
const DEFAULT_OCR_BATCH_SIZE = 5;
const DEFAULT_OCR_SEED_BATCH_SIZE = 10;

export const getNumericVar = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getMemoImageOcrQueueStatus = async (env: WorkerBindings): Promise<OcrQueueStatus> => {
  const [counts, processedToday] = await Promise.all([
    getMemoImageOcrQueueCounts(env.DB),
    countMemoImageOcrProcessedOn(env.DB, new Date().toISOString().slice(0, 10)),
  ]);

  return {
    ...counts,
    processedToday,
    dailyLimit: getNumericVar(env.OCR_DAILY_LIMIT, DEFAULT_OCR_DAILY_LIMIT),
    batchSize: getNumericVar(env.OCR_BATCH_SIZE, DEFAULT_OCR_BATCH_SIZE),
  };
};

const extractAssetKey = (env: WorkerBindings, imageUrl: string): string | null => {
  const bases = [env.ASSET_PUBLIC_BASE_URL, `${env.API_ORIGIN}/api/assets`, `${env.API_ORIGIN}/assets`].filter(Boolean);
  for (const base of bases) {
    if (imageUrl.startsWith(base)) {
      return imageUrl.slice(base.length + 1);
    }
  }
  return null;
};

const loadImageBlob = async (env: WorkerBindings, imageUrl: string): Promise<{ blob: Blob; name: string }> => {
  const objectKey = extractAssetKey(env, imageUrl);
  if (objectKey) {
    const object = await env.ASSETS.get(objectKey);
    if (!object) {
      throw new Error('图片不存在');
    }

    const mimeType = object.httpMetadata?.contentType || 'image/jpeg';
    return {
      blob: new Blob([await object.arrayBuffer()], { type: mimeType }),
      name: objectKey.split('/').pop() || 'image',
    };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`图片拉取失败 (${response.status})`);
  }

  return {
    blob: await response.blob(),
    name: imageUrl.split('/').pop()?.split('?')[0] || 'image',
  };
};

const runOcr = async (env: WorkerBindings, imageUrl: string): Promise<string> => {
  if (!env.AI?.toMarkdown) {
    throw new Error('Workers AI Markdown Conversion 未配置');
  }

  const file = await loadImageBlob(env, imageUrl);
  const result = await env.AI.toMarkdown({
    name: file.name,
    blob: file.blob,
  }) as { format?: string; data?: string; error?: string };

  if (result.format === 'error') {
    throw new Error(result.error || 'OCR 失败');
  }

  return (result.data || '').trim();
};

export const processMemoImageOcrQueue = async (env: WorkerBindings): Promise<{ processed: number; scanned: number; skipped: number }> => {
  if (!env.AI?.toMarkdown) {
    return { processed: 0, scanned: 0, skipped: 0 };
  }

  const dailyLimit = getNumericVar(env.OCR_DAILY_LIMIT, DEFAULT_OCR_DAILY_LIMIT);
  const batchSize = getNumericVar(env.OCR_BATCH_SIZE, DEFAULT_OCR_BATCH_SIZE);
  const seedBatchSize = getNumericVar(env.OCR_SEED_BATCH_SIZE, DEFAULT_OCR_SEED_BATCH_SIZE);
  const today = new Date().toISOString().slice(0, 10);
  const processedToday = await countMemoImageOcrProcessedOn(env.DB, today);
  const remaining = Math.max(0, dailyLimit - processedToday);

  if (remaining === 0) {
    return { processed: 0, scanned: 0, skipped: 0 };
  }

  const counts = await getMemoImageOcrQueueCounts(env.DB);
  const hasQueuedTasks = counts.pending + counts.failed > 0;
  const scanned = hasQueuedTasks ? 0 : await seedMissingMemoImageOcrTasks(env.DB, seedBatchSize);
  const tasks = await claimPendingMemoImageOcrTasks(env.DB, Math.min(batchSize, remaining));
  let processed = 0;
  let skipped = 0;
  const memoIdsToReindex = new Set<number>();

  for (const task of tasks) {
    try {
      const text = await runOcr(env, task.imageUrl);
      if (!text) {
        skipped++;
      }
      await markMemoImageOcrDone(env.DB, task.id, text);
      memoIdsToReindex.add(task.memoId);
      processed++;
    } catch (error) {
      await markMemoImageOcrFailed(env.DB, task.id, task.attemptCount + 1, error instanceof Error ? error.message : 'OCR 失败');
    }
  }

  for (const memoId of memoIdsToReindex) {
    await syncMemoToKnowledgeBase(env, memoId);
  }

  return { processed, scanned, skipped };
};
