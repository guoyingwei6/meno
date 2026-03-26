import type { MemoDetail, MemoSummary, MemoVisibility } from '../types';

const initialMemos: MemoSummary[] = [
  {
    id: 2,
    slug: 'public-memo-2',
    content: 'Second public memo',
    excerpt: 'Second public memo',
    visibility: 'public',
    displayDate: '2026-03-24',
    createdAt: '2026-03-24T12:30:00.000Z',
    updatedAt: '2026-03-24T12:30:00.000Z',
    publishedAt: '2026-03-24T12:30:00.000Z',
    deletedAt: null,
    previousVisibility: null,
    hasImages: false,
    imageCount: 0,
    tagCount: 1,
    tags: ['serverless'],
  },
  {
    id: 1,
    slug: 'public-memo-1',
    content: 'First public memo',
    excerpt: 'First public memo',
    visibility: 'public',
    displayDate: '2026-03-24',
    createdAt: '2026-03-24T09:00:00.000Z',
    updatedAt: '2026-03-24T09:00:00.000Z',
    publishedAt: '2026-03-24T09:00:00.000Z',
    deletedAt: null,
    previousVisibility: null,
    hasImages: false,
    imageCount: 0,
    tagCount: 2,
    tags: ['cloudflare', 'meno'],
  },
  {
    id: 3,
    slug: 'private-memo-1',
    content: 'Private memo',
    excerpt: 'Private memo',
    visibility: 'private',
    displayDate: '2026-03-23',
    createdAt: '2026-03-23T08:00:00.000Z',
    updatedAt: '2026-03-23T08:00:00.000Z',
    publishedAt: null,
    deletedAt: null,
    previousVisibility: null,
    hasImages: false,
    imageCount: 0,
    tagCount: 1,
    tags: ['private-note'],
  },
  {
    id: 4,
    slug: 'draft-memo-1',
    content: 'Draft memo',
    excerpt: 'Draft memo',
    visibility: 'draft',
    displayDate: '2026-03-22',
    createdAt: '2026-03-22T07:00:00.000Z',
    updatedAt: '2026-03-22T07:00:00.000Z',
    publishedAt: null,
    deletedAt: null,
    previousVisibility: null,
    hasImages: false,
    imageCount: 0,
    tagCount: 1,
    tags: ['draft-note'],
  },
];

let memos = structuredClone(initialMemos) as MemoSummary[];

export const resetMockMemos = () => {
  memos = structuredClone(initialMemos) as MemoSummary[];
};

export const listPublicMemos = (tag?: string, date?: string): MemoSummary[] => {
  let visibleMemos = memos.filter((memo) => memo.visibility === 'public' && memo.deletedAt === null);

  if (tag) {
    visibleMemos = visibleMemos.filter((memo) => memo.tags.includes(tag));
  }

  if (date) {
    visibleMemos = visibleMemos.filter((memo) => memo.displayDate === date);
  }

  return visibleMemos;
};

export const getPublicMemoBySlug = (slug: string): MemoDetail | null => {
  const memo = memos.find((item) => item.slug === slug && item.visibility === 'public' && item.deletedAt === null);

  if (!memo) {
    return null;
  }

  return {
    ...memo,
    assets: [],
  };
};

export const createMockMemo = (memo: MemoSummary): MemoDetail => {
  memos.unshift(memo);

  return {
    ...memo,
    assets: [],
  };
};

export const trashMockMemo = (id: number): boolean => {
  const memo = memos.find((item) => item.id === id);

  if (!memo) {
    return false;
  }

  memo.previousVisibility = memo.visibility;
  memo.deletedAt = new Date().toISOString();
  return true;
};

export const restoreMockMemo = (id: number): MemoDetail | null => {
  const memo = memos.find((item) => item.id === id);

  if (!memo) {
    return null;
  }

  memo.deletedAt = null;
  memo.visibility = (memo.previousVisibility ?? memo.visibility) as MemoVisibility;

  return {
    ...memo,
    assets: [],
  };
};

export const listAllMockMemos = (): MemoSummary[] => memos;

export const listAuthorMemos = (
  view: 'all' | 'public' | 'private' | 'draft' | 'trash' = 'all',
  date?: string,
): MemoSummary[] => {
  let filteredMemos: MemoSummary[];

  if (view === 'trash') {
    filteredMemos = memos.filter((memo) => memo.deletedAt !== null);
  } else {
    const activeMemos = memos.filter((memo) => memo.deletedAt === null);
    filteredMemos = view === 'all' ? activeMemos : activeMemos.filter((memo) => memo.visibility === view);
  }

  if (date) {
    filteredMemos = filteredMemos.filter((memo) => memo.displayDate === date);
  }

  return filteredMemos;
};

export const getPublicTagCounts = () => {
  const counts = new Map<string, number>();

  for (const memo of listPublicMemos()) {
    for (const tag of memo.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
};

export const getPublicDateCounts = () => {
  const counts = new Map<string, number>();

  for (const memo of listPublicMemos()) {
    counts.set(memo.displayDate, (counts.get(memo.displayDate) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

export const getAuthorStats = () => {
  const allMemos = listAllMockMemos();
  const activeMemos = allMemos.filter((memo) => memo.deletedAt === null);
  const uniqueTags = new Set(activeMemos.flatMap((memo) => memo.tags));

  return {
    total: activeMemos.length,
    public: activeMemos.filter((memo) => memo.visibility === 'public').length,
    private: activeMemos.filter((memo) => memo.visibility === 'private').length,
    draft: activeMemos.filter((memo) => memo.visibility === 'draft').length,
    trash: allMemos.filter((memo) => memo.deletedAt !== null).length,
    tags: uniqueTags.size,
  };
};
