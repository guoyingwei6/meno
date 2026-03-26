import type { MemoAsset, MemoDetail, MemoSummary, MemoVisibility } from '../../shared/src/types';

export type { MemoAsset, MemoDetail, MemoSummary, MemoVisibility };

export interface PublicMemosQuery {
  tag?: string;
  date?: string;
}

export interface CalendarQuery {
  scope?: 'public';
}

export interface SessionRecord {
  id: string;
  githubUserId: string;
  githubLogin: string;
  expiresAt: string;
  createdAt: string;
}

export interface MemoRecord extends MemoSummary {}

export interface MemoWithAssets extends MemoDetail {}
