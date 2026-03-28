import { withApiBase } from './runtime-config';
import type { MemoDetail, PublicMemoResponse, PublicMemosResponse, MemoSummary, TagListResponse } from '../types/shared';

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
    draft: number;
    trash: number;
    tags: number;
    streakDays: number;
  };
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
  view: 'all' | 'public' | 'private' | 'draft' | 'trash',
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
  input: { content?: string; visibility?: 'public' | 'private' | 'draft'; displayDate?: string },
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

export const createMemo = async (input: {
  content: string;
  visibility: 'public' | 'private' | 'draft';
  displayDate: string;
}): Promise<{ memo: MemoDetail }> => {
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
