export type MemoVisibility = 'public' | 'private' | 'draft';

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
