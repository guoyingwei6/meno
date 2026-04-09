export type MemoVisibility = 'public' | 'private';

export interface MemoSummary {
  id: number;
  slug: string;
  content: string;
  excerpt: string;
  visibility: MemoVisibility;
  displayDate: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  favoritedAt: string | null;
  previousVisibility: MemoVisibility | null;
  hasImages: boolean;
  imageCount: number;
  tagCount: number;
  tags: string[];
}

export interface MemoDetail extends MemoSummary {
  assets: MemoAsset[];
}

export interface MemoAsset {
  id: number;
  memoId: number;
  objectKey: string;
  originalUrl: string;
  previewUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number | null;
  createdAt: string;
}

export interface PublicMemosResponse {
  memos: MemoSummary[];
}

export interface PublicMemoResponse {
  memo: MemoDetail;
}

export interface TagListResponse {
  tags: Array<{
    tag: string;
    count: number;
  }>;
}

export interface CalendarDay {
  date: string;
  count: number;
}

export interface HeatmapCell {
  date: string;
  count: number;
}

export interface AiConfig {
  url: string;
  apiKey: string;
  model: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface KnowledgeSource {
  memoId: number;
  slug: string;
  visibility: MemoVisibility;
  displayDate: string;
  score?: number;
  tags: string[];
  snippet: string;
}

export interface KnowledgeChatResponse {
  answer: string;
  sources: KnowledgeSource[];
}

export interface KnowledgeIndexResponse {
  indexed: number;
}

export interface OcrQueueStatus {
  total: number;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  removed: number;
  processedToday: number;
  dailyLimit: number;
  batchSize: number;
}

export interface OcrQueueRunResponse {
  processed: number;
  scanned: number;
  skipped: number;
  status: OcrQueueStatus;
}
