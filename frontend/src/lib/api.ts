import { withApiBase } from './runtime-config';
import type {
  AiChatMessage,
  AiConfig,
  KnowledgeChatResponse,
  KnowledgeIndexResponse,
  MemoDetail,
  OcrQueueRunResponse,
  OcrQueueStatus,
  PublicMemoResponse,
  PublicMemosResponse,
  MemoSummary,
  TagListResponse,
} from '../types/shared';

export interface MeResponse {
  authenticated: boolean;
  role: 'viewer' | 'author';
  githubLogin: string | null;
}

export interface PublicStatsResponse {
  stats: {
    total: number;
    tags: number;
    streakDays: number;
  };
}

export interface DateCount {
  date: string;
  count: number;
}

export interface CalendarResponse {
  days: DateCount[];
}

export interface HeatmapResponse {
  cells: DateCount[];
}

export interface DashboardStatsResponse {
  stats: {
    total: number;
    public: number;
    private: number;
    trash: number;
    tags: number;
    streakDays: number;
  };
}

export interface CreateMemoVoiceNoteInput {
  objectKey: string;
  audioUrl: string;
  mimeType: string;
  durationMs: number;
  transcriptText?: string;
  transcriptSource?: string;
}

export interface CreateMemoInput {
  content: string;
  visibility: 'public' | 'private';
  displayDate: string;
  voiceNote?: CreateMemoVoiceNoteInput;
}

export const fetchPublicMemos = async (tag?: string, date?: string): Promise<PublicMemosResponse> => {
  const params = new URLSearchParams();
  if (tag) params.set('tag', tag);
  if (date) params.set('date', date);
  const search = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(withApiBase(`/api/public/memos${search}`));

  if (!response.ok) {
    throw new Error('Failed to fetch public memos');
  }

  return response.json();
};

export const searchPublicMemos = async (q: string): Promise<PublicMemosResponse> => {
  const response = await fetch(withApiBase(`/api/public/memos/search?q=${encodeURIComponent(q)}`));
  if (!response.ok) throw new Error('Failed to search memos');
  return response.json();
};

export const searchDashboardMemos = async (q: string): Promise<{ memos: MemoSummary[] }> => {
  const response = await fetch(withApiBase(`/api/dashboard/memos/search?q=${encodeURIComponent(q)}`), { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to search memos');
  return response.json();
};

export const fetchPublicMemo = async (slug: string): Promise<PublicMemoResponse> => {
  const response = await fetch(withApiBase(`/api/public/memos/${slug}`));

  if (!response.ok) {
    throw new Error('Failed to fetch public memo');
  }

  return response.json();
};

export const fetchAuthorMemo = async (slug: string): Promise<PublicMemoResponse> => {
  const response = await fetch(withApiBase(`/api/dashboard/memos/${slug}`), {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch author memo');
  }

  return response.json();
};

export const fetchMe = async (): Promise<MeResponse> => {
  const response = await fetch(withApiBase('/api/me'), {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch current session');
  }

  return response.json();
};

export const fetchPublicTags = async (): Promise<TagListResponse> => {
  const response = await fetch(withApiBase('/api/public/tags'));

  if (!response.ok) {
    throw new Error('Failed to fetch public tags');
  }

  return response.json();
};

export const fetchDashboardTags = async (): Promise<TagListResponse> => {
  const response = await fetch(withApiBase('/api/dashboard/tags'), { credentials: 'include' });

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard tags');
  }

  return response.json();
};

export const fetchDashboardMemos = async (
  view: 'all' | 'public' | 'private' | 'trash' | 'favorited',
  date?: string,
): Promise<{ memos: MemoSummary[] }> => {
  const params = new URLSearchParams({ view });
  if (date) params.set('date', date);
  const response = await fetch(withApiBase(`/api/dashboard/memos?${params.toString()}`), {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard memos');
  }

  return response.json();
};

export const fetchPublicStats = async (): Promise<PublicStatsResponse> => {
  const response = await fetch(withApiBase('/api/public/stats'));

  if (!response.ok) {
    throw new Error('Failed to fetch public stats');
  }

  return response.json();
};

export const fetchPublicCalendar = async (): Promise<CalendarResponse> => {
  const response = await fetch(withApiBase('/api/public/calendar'));

  if (!response.ok) {
    throw new Error('Failed to fetch public calendar');
  }

  return response.json();
};

export const fetchPublicHeatmap = async (): Promise<HeatmapResponse> => {
  const response = await fetch(withApiBase('/api/public/heatmap'));

  if (!response.ok) {
    throw new Error('Failed to fetch public heatmap');
  }

  return response.json();
};

export const fetchDashboardCalendar = async (): Promise<CalendarResponse> => {
  const response = await fetch(withApiBase('/api/dashboard/calendar'), {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard calendar');
  }

  return response.json();
};

export const fetchDashboardStats = async (): Promise<DashboardStatsResponse> => {
  const response = await fetch(withApiBase('/api/dashboard/stats'), { credentials: 'include' });

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard stats');
  }

  return response.json();
};

export interface RecordStatsResponse {
  totalMemos: number;
  totalWords: number;
  maxDailyMemos: number;
  maxDailyWords: number;
  activeDays: number;
  yearMemos: number;
  totalStorageBytes: number;
  imageCount: number;
  heatmap: { date: string; count: number }[];
}

export const fetchPublicRecordStats = async (): Promise<RecordStatsResponse> => {
  const response = await fetch(withApiBase('/api/public/record-stats'));
  if (!response.ok) throw new Error('Failed to fetch public record stats');
  return response.json();
};

export const fetchDashboardRecordStats = async (): Promise<RecordStatsResponse> => {
  const response = await fetch(withApiBase('/api/dashboard/record-stats'), { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch dashboard record stats');
  return response.json();
};

export const rebuildKnowledgeIndex = async (): Promise<KnowledgeIndexResponse> => {
  const response = await fetch(withApiBase('/api/ai/index'), {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || 'Failed to rebuild knowledge index');
  }

  return response.json();
};

export const chatWithKnowledgeBase = async (
  question: string,
  config: AiConfig,
  history: AiChatMessage[] = [],
): Promise<KnowledgeChatResponse> => {
  const response = await fetch(withApiBase('/api/ai/chat'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, config, history }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || 'Failed to chat with knowledge base');
  }

  return response.json();
};

export const fetchOcrQueueStatus = async (): Promise<OcrQueueStatus> => {
  const response = await fetch(withApiBase('/api/ai/ocr/status'), {
    credentials: 'include',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || 'Failed to fetch OCR queue status');
  }

  return response.json();
};

export const runOcrQueue = async (): Promise<OcrQueueRunResponse> => {
  const response = await fetch(withApiBase('/api/ai/ocr/run'), {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || 'Failed to run OCR queue');
  }

  return response.json();
};

export const logout = async (): Promise<void> => {
  const response = await fetch(withApiBase('/api/auth/logout'), {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to logout');
  }
};

export const updateMemo = async (
  id: number,
  input: { content?: string; visibility?: 'public' | 'private'; displayDate?: string },
): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase(`/api/memos/${id}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error('Failed to update memo');
  }

  return response.json();
};

export const createMemo = async (input: CreateMemoInput): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase('/api/memos'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error('Failed to create memo');
  }

  return response.json();
};

export const restoreMemo = async (id: number): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase(`/api/memos/${id}/restore`), {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to restore memo');
  }

  return response.json();
};

export const pinMemo = async (id: number): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase(`/api/memos/${id}/pin`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to pin memo');
  return response.json();
};

export const unpinMemo = async (id: number): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase(`/api/memos/${id}/unpin`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to unpin memo');
  return response.json();
};

export const favoriteMemo = async (id: number): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase(`/api/memos/${id}/favorite`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to favorite memo');
  return response.json();
};

export const unfavoriteMemo = async (id: number): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase(`/api/memos/${id}/unfavorite`), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to unfavorite memo');
  return response.json();
};

export const deleteMemo = async (id: number): Promise<{ success: boolean }> => {
  const response = await fetch(withApiBase(`/api/memos/${id}`), {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to delete memo');
  }

  return response.json();
};

export const renameTag = async (oldTag: string, newTag: string): Promise<{ updated: number }> => {
  const response = await fetch(withApiBase('/api/dashboard/tags/rename'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldTag, newTag }),
  });

  if (!response.ok) {
    throw new Error('Failed to rename tag');
  }

  return response.json();
};

export const deleteTag = async (tag: string, deleteNotes: boolean): Promise<{ deleted: number }> => {
  const response = await fetch(withApiBase('/api/dashboard/tags/delete'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag, deleteNotes }),
  });

  if (!response.ok) {
    throw new Error('Failed to delete tag');
  }

  return response.json();
};

export const uploadFile = async (file: File): Promise<{ url: string; objectKey: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(withApiBase('/api/uploads'), {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!response.ok) throw new Error('Failed to upload file');
  return response.json();
};
