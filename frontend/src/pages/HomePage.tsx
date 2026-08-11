import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MemoComposer } from '../components/MemoComposer';
import { MemoTimeline } from '../components/MemoTimeline';
import { SidebarShell } from '../components/SidebarShell';
import { SettingsPanel } from '../components/SettingsPanel';
import { TimelineHeader } from '../components/TimelineHeader';
import type { SortMode } from '../components/TimelineHeader';
import { TopBar } from '../components/TopBar';
import { StatsView } from '../components/StatsView';
import { createMemo, DEFAULT_APP_SETTINGS, deleteMemo, deleteTag as deleteTagApi, favoriteMemo as favoriteMemoApi, fetchAppSettings, fetchDashboardCalendar, fetchDashboardMemos, fetchDashboardStats, fetchDashboardTags, fetchMe, fetchPublicCalendar, fetchPublicMemos, fetchPublicStats, fetchPublicTags, logout, pinMemo as pinMemoApi, renameTag as renameTagApi, restoreMemo, searchDashboardMemos, searchPublicMemos, unfavoriteMemo as unfavoriteMemoApi, unpinMemo as unpinMemoApi, updateAppSettings, updateMemo } from '../lib/api';
import type { AppSettings, CalendarResponse, DashboardStatsResponse, MeResponse, PublicStatsResponse } from '../lib/api';
import { buildTagTree } from '../lib/tag-tree';
import { enqueueOutbox, listOutbox, type MemoDraftRecord, type MemoOutboxRecord } from '../lib/draft-store';
import { replayOutbox } from '../lib/outbox';
import { readPublicFeedCache, writePublicFeedCache } from '../lib/public-feed-cache';
import { withApiBase } from '../lib/runtime-config';
import type { MemoFilters } from '../components/SidebarShell';
import { useTheme, colors } from '../lib/theme';
import type { MemoSummary, PublicMemosResponse } from '../types/shared';
import { Sheet } from '../components/ui/Sheet';

const MOBILE_BREAKPOINT = 768;
const MEMO_PAGE_SIZE = 20;
const DeepChatModal = lazy(() => import('../components/DeepChatModal').then((module) => ({ default: module.DeepChatModal })));
const AiConfigModal = lazy(() => import('../components/AiConfigModal').then((module) => ({ default: module.AiConfigModal })));
const ImportExportModal = lazy(() => import('../components/ImportExportModal').then((module) => ({ default: module.ImportExportModal })));

type PublicSiteSettingsResponse = { settings: Pick<AppSettings, 'siteTitle'> };

const fetchPublicSiteSettings = async (): Promise<PublicSiteSettingsResponse> => {
  const response = await fetch(withApiBase('/api/public/settings'));
  if (!response.ok) throw new Error('Failed to fetch public site settings');
  const payload = await response.json() as {
    settings?: { siteTitle?: unknown };
    siteTitle?: unknown;
  };
  const siteTitle = typeof payload.settings?.siteTitle === 'string'
    ? payload.settings.siteTitle
    : typeof payload.siteTitle === 'string'
      ? payload.siteTitle
      : '';
  return { settings: { siteTitle: siteTitle.trim() } };
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

export const HomePage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'all' | 'private' | 'trash' | 'onThisDay' | 'dailyReview' | 'stats' | 'favorited' | 'deepChat'>('all');
  const [reviewSeed, setReviewSeed] = useState(0);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [filters, setFilters] = useState<MemoFilters>({});
  const [sortMode, setSortMode] = useState<SortMode>('display-desc');
  const [showImportExport, setShowImportExport] = useState(false);
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [outboxRecords, setOutboxRecords] = useState<MemoOutboxRecord[]>([]);
  const [outboxBusy, setOutboxBusy] = useState(false);

  // Sync sidebar default when crossing breakpoint
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const closeSidebarOnMobile = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setActiveView('all');
    setActiveTag(null);
    setFilters({});
    closeSidebarOnMobile();
  };

  const handleSelectView = (view: 'all' | 'private' | 'trash' | 'onThisDay' | 'dailyReview' | 'stats' | 'favorited' | 'deepChat') => {
    if (view === 'dailyReview') setReviewSeed((s) => s + 1);
    setActiveView(view);
    setSelectedDate(null);
    setActiveTag(null);
    setFilters({});
    closeSidebarOnMobile();
  };

  const handleSelectTag = (tag: string | null) => {
    setActiveTag(tag);
    setSelectedDate(null);
    setActiveView('all');
    closeSidebarOnMobile();
  };

  const { data: me, isLoading: isLoadingMe, isError: isMeError } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => fetchMe(),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const isAuthor = me?.authenticated === true && me.role === 'author';
  const authState: 'pending' | 'authenticated' | 'unauthenticated' = isLoadingMe
    ? 'pending'
    : isAuthor
      ? 'authenticated'
      : 'unauthenticated';

  const { data: settingsData } = useQuery<{ settings: AppSettings }>({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
    enabled: isAuthor,
    retry: 1,
    staleTime: 60_000,
  });
  const { data: publicSettingsData } = useQuery<PublicSiteSettingsResponse>({
    queryKey: ['public-settings'],
    queryFn: fetchPublicSiteSettings,
    // Keep public branding independent from /api/me. A missing endpoint is
    // non-blocking; the default title remains in use until it is available.
    enabled: !isAuthor,
    retry: false,
    staleTime: 60_000,
  });
  const publicSiteTitle = publicSettingsData?.settings.siteTitle.trim();
  const appSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...(publicSiteTitle ? { siteTitle: publicSiteTitle } : {}),
    ...(isAuthor ? settingsData?.settings : {}),
  };

  useEffect(() => {
    if (appSettings.siteTitle.trim()) document.title = appSettings.siteTitle;
  }, [appSettings.siteTitle]);

  const refreshOutbox = useCallback(async () => {
    setOutboxRecords(await listOutbox());
  }, []);

  const invalidateMemoQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
    ]);
  }, [queryClient]);

  const retryOutbox = useCallback(async () => {
    if (!isAuthor || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    setOutboxBusy(true);
    try {
      const result = await replayOutbox();
      await refreshOutbox();
      if (result.sent > 0) await invalidateMemoQueries();
    } finally {
      setOutboxBusy(false);
    }
  }, [invalidateMemoQueries, isAuthor, refreshOutbox]);

  useEffect(() => {
    void refreshOutbox();
    if (isAuthor) void retryOutbox();
    const handleOnline = () => { void retryOutbox(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [isAuthor, refreshOutbox, retryOutbox]);

  const apiView = activeView === 'private' ? 'private' : activeView === 'trash' ? 'trash' : activeView === 'favorited' ? 'favorited' : 'public';
  const hasImagesFilter = filters.hasImages ?? undefined;
  const hasTagsFilter = filters.hasTags ?? undefined;
  // Search and the two intentionally local views do not use server pagination.
  // Ordinary feed pages are already sorted and filtered by the API.
  const useServerPagination = !debouncedSearch
    && activeView !== 'stats'
    && activeView !== 'deepChat'
    && activeView !== 'onThisDay'
    && activeView !== 'dailyReview';
  const feedEnabled = !debouncedSearch && activeView !== 'stats' && activeView !== 'deepChat';
  const feedQueryKey = useMemo(
    () => isAuthor
      ? ['dashboard-memos', apiView, selectedDate, activeTag, sortMode, hasImagesFilter, hasTagsFilter, useServerPagination]
      : ['public-memos', selectedDate, activeTag, sortMode, hasImagesFilter, hasTagsFilter, useServerPagination],
    [activeTag, apiView, hasImagesFilter, hasTagsFilter, isAuthor, selectedDate, sortMode, useServerPagination],
  );

  const shouldUsePublicFeedCache = !isAuthor
    && activeView === 'all'
    && !selectedDate
    && !activeTag
    && !debouncedSearch
    && filters.hasImages === undefined
    && filters.hasTags === undefined
    && sortMode === 'display-desc'
    && useServerPagination;
  const publicFeedCache = useMemo(
    () => shouldUsePublicFeedCache ? readPublicFeedCache() : null,
    [shouldUsePublicFeedCache],
  );
  const publicFeedInitialData = useMemo<InfiniteData<PublicMemosResponse> | undefined>(
    () => publicFeedCache
      ? { pages: [publicFeedCache.response], pageParams: [undefined] }
      : undefined,
    [publicFeedCache],
  );

  const { data, isPending: isFeedPending, isError: isFeedError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch: refetchFeed } = useInfiniteQuery<PublicMemosResponse>({
    queryKey: feedQueryKey,
    queryFn: async ({ pageParam }) => {
      const pagination = useServerPagination
        ? {
          limit: MEMO_PAGE_SIZE,
          cursor: typeof pageParam === 'string' ? pageParam : undefined,
          sort: sortMode,
          hasImages: hasImagesFilter,
          hasTags: hasTagsFilter,
        }
        : undefined;
      if (isAuthor) {
        return fetchDashboardMemos(apiView as 'all' | 'public' | 'private' | 'trash' | 'favorited', selectedDate ?? undefined, pagination, activeTag ?? undefined);
      }
      const response = await fetchPublicMemos(activeTag ?? undefined, selectedDate ?? undefined, pagination);
      if (shouldUsePublicFeedCache && pageParam === undefined) writePublicFeedCache(response);
      return response;
    },
    initialPageParam: undefined,
    initialData: publicFeedInitialData,
    initialDataUpdatedAt: publicFeedCache?.cachedAt,
    getNextPageParam: (lastPage) => useServerPagination ? lastPage.nextCursor ?? undefined : undefined,
    // Public data starts immediately while /api/me is still in flight. Once
    // identity is confirmed the query key switches to the author feed.
    enabled: feedEnabled,
    retry: 1,
    staleTime: publicFeedInitialData ? 0 : 15_000,
  });

  const { data: searchData, isPending: isSearchPending, isError: isSearchError, refetch: refetchSearch } = useQuery({
    queryKey: isAuthor ? ['dashboard-search', debouncedSearch] : ['public-search', debouncedSearch],
    queryFn: () => (isAuthor ? searchDashboardMemos(debouncedSearch) : searchPublicMemos(debouncedSearch)),
    enabled: debouncedSearch.length > 0,
    retry: 1,
    staleTime: 10_000,
  });

  const { data: tagsData } = useQuery({
    queryKey: isAuthor ? ['dashboard-tags'] : ['public-tags'],
    queryFn: () => (isAuthor ? fetchDashboardTags() : fetchPublicTags()),
    enabled: true,
    retry: 1,
    staleTime: 60_000,
  });

  const { data: publicStatsData } = useQuery<PublicStatsResponse>({
    queryKey: ['public-stats'],
    queryFn: fetchPublicStats,
    enabled: !isAuthor,
    retry: 1,
    staleTime: 60_000,
  });

  const { data: calendarData } = useQuery<CalendarResponse>({
    queryKey: isAuthor ? ['dashboard-calendar'] : ['public-calendar'],
    queryFn: () => (isAuthor ? fetchDashboardCalendar() : fetchPublicCalendar()),
    enabled: true,
    retry: 1,
    staleTime: 60_000,
  });

  const { data: statsData } = useQuery<DashboardStatsResponse>({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    enabled: isAuthor,
    retry: 1,
    staleTime: 30_000,
  });

  const createMemoMutation = useMutation({
    mutationFn: (input: Parameters<typeof createMemo>[0]) =>
      createMemo(input),
    onSuccess: ({ memo }) => {
      // The memo response is the commit point for Composer. Refresh related
      // views in parallel without making draft cleanup wait for them.
      if (
        isAuthor
        && useServerPagination
        && !debouncedSearch
        && !selectedDate
        && !activeTag
        && filters.hasTags === undefined
        && filters.hasImages === undefined
        && sortMode === 'display-desc'
        && (activeView === 'all' || activeView === 'private')
        && !memo.deletedAt
        && ((activeView === 'all' && memo.visibility === 'public') || (activeView === 'private' && memo.visibility === 'private'))
      ) {
        queryClient.setQueryData<InfiniteData<PublicMemosResponse>>(feedQueryKey, (current) => {
          if (!current || current.pages.length === 0 || current.pages[0].memos.some((item) => item.id === memo.id)) return current;
          return {
            ...current,
            pages: [{ ...current.pages[0], memos: [memo, ...current.pages[0].memos] }, ...current.pages.slice(1)],
          };
        });
      }
      void invalidateMemoQueries();
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (input: Pick<AppSettings, 'siteTitle' | 'defaultVisibility'>) => updateAppSettings(input),
    onSuccess: ({ settings }) => {
      queryClient.setQueryData(['app-settings'], { settings });
      queryClient.setQueryData(['public-settings'], { settings: { siteTitle: settings.siteTitle } });
      setSettingsSaveError(null);
      setShowSettings(false);
    },
    onError: (error) => {
      setSettingsSaveError(error instanceof Error ? error.message : '设置保存失败，请重试');
    },
  });

  const updateMemoMutation = useMutation({
    mutationFn: (vars: { id: number; input: { content?: string; visibility?: 'public' | 'private'; displayDate?: string } }) =>
      updateMemo(vars.id, vars.input),
    onSuccess: () => { void invalidateMemoQueries(); },
  });

  const deleteMemoMutation = useMutation({
    mutationFn: (id: number) => deleteMemo(id),
    onSuccess: () => { void invalidateMemoQueries(); },
  });

  const restoreMemoMutation = useMutation({
    mutationFn: (id: number) => restoreMemo(id),
    onSuccess: () => { void invalidateMemoQueries(); },
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => pinMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] }); },
  });
  const unpinMutation = useMutation({
    mutationFn: (id: number) => unpinMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] }); },
  });
  const favoriteMutation = useMutation({
    mutationFn: (id: number) => favoriteMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] }); },
  });
  const unfavoriteMutation = useMutation({
    mutationFn: (id: number) => unfavoriteMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] }); },
  });
  const renameTagMutation = useMutation({
    mutationFn: (vars: { oldTag: string; newTag: string }) => renameTagApi(vars.oldTag, vars.newTag),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
    },
  });
  const deleteTagMutation = useMutation({
    mutationFn: (vars: { tag: string; deleteNotes: boolean }) => deleteTagApi(vars.tag, vars.deleteNotes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });

  const allTags: Array<{ tag: string; count: number }> = useMemo(
    () => (Array.isArray(tagsData?.tags) ? tagsData.tags : []),
    [tagsData],
  );
  const allTagNames = useMemo(() => allTags.map((tag) => tag.tag), [allTags]);
  const tagTree = useMemo(() => buildTagTree(allTags), [allTags]);

  const handleOpenMemo = useCallback((memo: MemoSummary) => {
    navigate(`/memos/${memo.slug}`);
  }, [navigate]);

  const handleOpenTagMemo = useCallback((tag: string) => {
    navigate(`/tags/${tag}`);
  }, [navigate]);

  const handleSaveEditMemo = useCallback((memo: MemoSummary, input: { content: string; visibility: 'public' | 'private'; displayDate: string }) => {
    updateMemoMutation.mutate({ id: memo.id, input });
  }, [updateMemoMutation.mutate]);

  const handleRestoreMemo = useCallback((memo: MemoSummary) => {
    restoreMemoMutation.mutate(memo.id);
  }, [restoreMemoMutation.mutate]);

  const handleDeleteMemo = useCallback((memo: MemoSummary) => {
    deleteMemoMutation.mutate(memo.id);
  }, [deleteMemoMutation.mutate]);

  const handleChangeVisibility = useCallback((memo: MemoSummary, visibility: 'public' | 'private') => {
    updateMemoMutation.mutate({ id: memo.id, input: { visibility } });
  }, [updateMemoMutation.mutate]);

  const handleFillTagsMemo = useCallback((id: number, newContent: string) => {
    updateMemoMutation.mutate({ id, input: { content: newContent } });
  }, [updateMemoMutation.mutate]);

  const handlePinMemo = useCallback((memo: MemoSummary) => {
    if (memo.pinnedAt) {
      unpinMutation.mutate(memo.id);
    } else {
      pinMutation.mutate(memo.id);
    }
  }, [pinMutation.mutate, unpinMutation.mutate]);

  const handleFavoriteMemo = useCallback((memo: MemoSummary) => {
    if (memo.favoritedAt) {
      unfavoriteMutation.mutate(memo.id);
    } else {
      favoriteMutation.mutate(memo.id);
    }
  }, [favoriteMutation.mutate, unfavoriteMutation.mutate]);

  const handleLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const now = new Date();
  const todayMonthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayYear = now.getFullYear().toString();

  const memos = useMemo(() => {
    if (debouncedSearch) return searchData?.memos ?? [];
    if ((activeView === 'trash' || activeView === 'private' || activeView === 'favorited') && !isAuthor) return [];
    let all = data?.pages.flatMap((page) => page.memos) ?? [];
    if (useServerPagination) return all;
    if (activeView === 'onThisDay') {
      all = all.filter((m) => {
        const md = m.displayDate.slice(5, 10);
        const yr = m.displayDate.slice(0, 4);
        return md === todayMonthDay && yr !== todayYear;
      });
    }
    if (activeView === 'dailyReview') {
      const shuffled = [...all].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, 3);
    }
    if (filters.hasTags === true) all = all.filter((m) => m.tags.length > 0);
    if (filters.hasTags === false) all = all.filter((m) => m.tags.length === 0);
    if (filters.hasImages === true) all = all.filter((m) => m.hasImages);
    if (filters.hasImages === false) all = all.filter((m) => !m.hasImages);
    if (activeTag) {
      all = all.filter((m) => m.tags.some((t: string) => t === activeTag || t.startsWith(`${activeTag}/`)));
    }
    const sorted = [...all];
    switch (sortMode) {
      case 'display-desc':
        sorted.sort((a, b) => b.displayDate.localeCompare(a.displayDate) || b.createdAt.localeCompare(a.createdAt));
        break;
      case 'display-asc':
        sorted.sort((a, b) => a.displayDate.localeCompare(b.displayDate) || a.createdAt.localeCompare(b.createdAt));
        break;
      case 'created-desc':
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case 'created-asc':
        sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case 'updated-desc':
        sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        break;
      case 'updated-asc':
        sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        break;
    }
    if ((activeView === 'all' || activeView === 'favorited') && !activeTag) {
      sorted.sort((a, b) => {
        const ap = a.pinnedAt ? 1 : 0;
        const bp = b.pinnedAt ? 1 : 0;
        return bp - ap;
      });
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, searchData, debouncedSearch, activeTag, activeView, filters, todayMonthDay, todayYear, reviewSeed, sortMode, useServerPagination]);

  const isSearchActive = Boolean(debouncedSearch);
  const isMemoRequestPending = isSearchActive ? isSearchPending : isFeedPending;
  const isMemoRequestError = isSearchActive ? isSearchError : isFeedError;
  const hasMemoRequestData = isSearchActive ? Boolean(searchData) : Boolean(data);
  const retryMemoRequest = isSearchActive ? refetchSearch : refetchFeed;

  const todayStr = new Date().toISOString().slice(0, 10);
  const hasOnThisDay = (calendarData?.days ?? []).some((d) => d.date.slice(5, 10) === todayMonthDay && d.date.slice(0, 4) !== todayYear);

  const pageStyle: React.CSSProperties = { ...styles.page, background: c.pageBg, color: c.textPrimary };
  const sidebarMobileOpen: React.CSSProperties = { ...styles.sidebarMobileOpen, background: c.sidebarBg };
  const sidebarStyle: React.CSSProperties = isMobile
    ? { ...styles.sidebar, ...(sidebarOpen ? sidebarMobileOpen : styles.sidebarMobileClosed) }
    : { ...styles.sidebar, ...(sidebarOpen ? {} : { display: 'none' }) };
  const sidebarContent = (
    <SidebarShell
      siteTitle={appSettings.siteTitle}
      memoCount={isAuthor ? (statsData?.stats.public ?? memos.length) : (publicStatsData?.stats.total ?? memos.length)}
      tagCount={isAuthor ? (statsData?.stats.tags ?? allTags.length) : (publicStatsData?.stats.tags ?? allTags.length)}
      streakDays={isAuthor ? (statsData?.stats.streakDays ?? 0) : (publicStatsData?.stats.streakDays ?? 0)}
      activeDate={selectedDate}
      calendarDays={calendarData?.days ?? []}
      activeView={activeView}
      activeTag={activeTag}
      filters={filters}
      tagTree={tagTree}
      hasOnThisDay={hasOnThisDay}
      style={isMobile ? { minHeight: 0, flex: '1 1 0', overflowY: 'auto' as const } : undefined}
      onSelectView={handleSelectView}
      onSelectDate={handleSelectDate}
      onSelectTag={handleSelectTag}
      onChangeFilters={setFilters}
      authenticated={Boolean(isAuthor)}
      githubLogin={me?.githubLogin ?? null}
      onRenameTag={(oldTag, newTag) => {
        if (activeTag === oldTag || activeTag?.startsWith(`${oldTag}/`)) {
          const nextActiveTag = activeTag === oldTag ? newTag : `${newTag}${activeTag.slice(oldTag.length)}`;
          setActiveTag(nextActiveTag);
        }
        renameTagMutation.mutate({ oldTag, newTag });
      }}
      onDeleteTag={(tag, deleteNotes) => {
        if (activeTag === tag || activeTag?.startsWith(`${tag}/`)) setActiveTag(null);
        deleteTagMutation.mutate({ tag, deleteNotes });
      }}
      onLogout={async () => { await logout(); window.location.assign('/'); }}
    />
  );

  return (
    <div style={pageStyle}>
      {showImportExport && (
        <Suspense fallback={null}>
          <ImportExportModal
            onClose={() => setShowImportExport(false)}
            onImportDone={async () => {
              await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
              await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
              await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            }}
          />
        </Suspense>
      )}
      {showAiConfig && (
        <Suspense fallback={null}>
          <AiConfigModal onClose={() => setShowAiConfig(false)} />
        </Suspense>
      )}
      {showSettings && isAuthor && (
        <SettingsPanel
          settings={appSettings}
          saving={updateSettingsMutation.isPending}
          error={settingsSaveError}
          onClose={() => { setShowSettings(false); setSettingsSaveError(null); }}
          onSave={async (input) => { await updateSettingsMutation.mutateAsync(input); }}
        />
      )}
      {isMobile ? (
        <Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} label="导航菜单" panelStyle={sidebarStyle}>
          {sidebarContent}
        </Sheet>
      ) : (
        <div style={sidebarStyle}>{sidebarContent}</div>
      )}
      <main style={isMobile ? styles.mainMobile : styles.main}>
        <TopBar
          authenticated={Boolean(isAuthor)}
          githubLogin={me?.githubLogin ?? null}
          onLogout={async () => {
            await logout();
            window.location.assign('/');
          }}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onRefresh={async () => { await queryClient.refetchQueries(); }}
          onImportExport={() => setShowImportExport(true)}
          onAiConfig={() => setShowAiConfig(true)}
          onSettings={() => { setSettingsSaveError(null); setShowSettings(true); }}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        {activeView === 'stats' ? (
          <StatsView isAuthor={Boolean(isAuthor)} />
        ) : activeView === 'deepChat' ? (
          <Suspense fallback={<div style={styles.loadingPanel}>Loading...</div>}>
            <DeepChatModal embedded onOpenAiConfig={() => setShowAiConfig(true)} />
          </Suspense>
        ) : (
          <>
            {outboxRecords.length > 0 && (
              <div role="status" style={{ ...styles.outboxBanner, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>
                <span>{outboxRecords.length} 条笔记在待发送箱{outboxRecords.some((record) => record.status === 'failed') ? '（上次发送失败）' : ''}</span>
                <button type="button" onClick={() => { void retryOutbox(); }} disabled={outboxBusy} style={{ ...styles.retryButton, color: c.textPrimary, borderColor: c.borderMedium }}>
                  {outboxBusy ? '发送中...' : '重试发送'}
                </button>
              </div>
            )}
            <MemoComposer
              defaultDisplayDate={todayStr}
              defaultVisibility={appSettings.defaultVisibility}
              existingTags={allTags}
              authState={authState}
              onQueueOffline={async (draft: MemoDraftRecord) => {
                await enqueueOutbox(draft);
                await refreshOutbox();
              }}
              onSubmit={async (input) => {
                await createMemoMutation.mutateAsync(input);
              }}
            />
            {!isAuthor && (
              <div style={{ ...styles.loginHint, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>
                <span>登录后发布 memo</span>
                {authState === 'pending' ? <span style={{ marginLeft: 8 }}>（正在验证身份）</span> : isMeError ? <span style={{ marginLeft: 8 }}>（身份验证失败）</span> : null}
              </div>
            )}
            {activeView === 'trash' && !isAuthor && (
              <div style={{ ...styles.loginHint, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>登录后查看已删除的笔记</div>
            )}
            {activeView === 'private' && !isAuthor && (
              <div style={{ ...styles.loginHint, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>登录后查看私密笔记</div>
            )}
            {activeView === 'favorited' && !isAuthor && (
              <div style={{ ...styles.loginHint, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>登录后查看收藏笔记</div>
            )}
            {activeView === 'trash' && isAuthor && (
              <div style={{ ...styles.trashNotice, color: c.textMuted }}>回收站内的笔记仅保留 30 天</div>
            )}
            <TimelineHeader count={memos.length} sortMode={sortMode} onSortChange={setSortMode} />
            {isMemoRequestPending && !hasMemoRequestData ? (
              <div style={styles.feedSkeleton} aria-label="正在加载笔记">
                <div style={styles.skeletonLine} />
                <div style={{ ...styles.skeletonLine, width: '82%' }} />
                <div style={{ ...styles.skeletonLine, width: '58%' }} />
              </div>
            ) : isMemoRequestError && !hasMemoRequestData ? (
              <div style={{ ...styles.feedError, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }} role="alert">
                <span>{isSearchActive ? '搜索失败，请稍后重试。' : '笔记加载失败，请稍后重试。'}</span>
                <button type="button" style={{ ...styles.retryButton, color: c.textPrimary, borderColor: c.borderMedium }} onClick={() => { void retryMemoRequest(); }}>重试</button>
              </div>
            ) : memos.length > 0 ? (
              <MemoTimeline
                memos={memos}
                isAuthor={Boolean(isAuthor)}
                isTrash={activeView === 'trash'}
                allTags={allTagNames}
                onOpenMemo={handleOpenMemo}
                onOpenTag={handleOpenTagMemo}
                onSaveEditMemo={handleSaveEditMemo}
                onRestoreMemo={handleRestoreMemo}
                onDeleteMemo={handleDeleteMemo}
                onChangeVisibility={handleChangeVisibility}
                onFillTagsMemo={handleFillTagsMemo}
                onPinMemo={handlePinMemo}
                onFavoriteMemo={handleFavoriteMemo}
                hasMore={useServerPagination ? hasNextPage : false}
                isLoadingMore={isFetchingNextPage}
                onLoadMore={useServerPagination ? handleLoadMore : undefined}
              />
            ) : (
              <div style={{ ...styles.emptyState, color: c.textMuted }}>暂无笔记</div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#f7f7f7',
    color: '#111',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    position: 'relative',
  },
  sidebar: {
    flexShrink: 0,
  },
  sidebarMobileOpen: {
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 100,
    width: '80%',
    maxWidth: 320,
    background: '#fbfbfb',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '4px 0 16px rgba(0,0,0,0.1)',
  },
  sidebarMobileClosed: {
    display: 'none',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.3)',
    zIndex: 99,
  },
  main: {
    flex: '1 1 0',
    maxWidth: 680,
    padding: '24px 28px 48px',
    boxSizing: 'border-box',
    width: '100%',
  },
  mainMobile: {
    flex: '1 1 0',
    maxWidth: '100%',
    padding: '16px 12px 48px',
    boxSizing: 'border-box',
    width: '100%',
  },
  loginHint: {
    marginBottom: 16,
    padding: '14px 18px',
    borderRadius: 12,
    border: '1px dashed #d9d9d9',
    color: '#999',
    background: '#fff',
    fontSize: 14,
  },
  trashNotice: {
    marginBottom: 12,
    padding: '10px 16px',
    fontSize: 13,
    textAlign: 'center',
  },
  loading: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    fontSize: 16,
    color: '#999',
  },
  loadingPanel: {
    padding: '24px 0',
    textAlign: 'center',
    fontSize: 14,
    color: '#999',
  },
  feedSkeleton: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '18px 20px',
    borderRadius: 12,
    background: 'rgba(127,127,127,0.08)',
  },
  skeletonLine: {
    height: 12,
    width: '92%',
    borderRadius: 999,
    background: 'rgba(127,127,127,0.18)',
  },
  feedError: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 12,
    border: '1px solid',
    fontSize: 14,
  },
  outboxBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid',
    fontSize: 13,
  },
  retryButton: {
    border: '1px solid',
    background: 'transparent',
    borderRadius: 8,
    padding: '5px 10px',
    cursor: 'pointer',
    fontSize: 13,
  },
  emptyState: {
    padding: '28px 0',
    textAlign: 'center',
    fontSize: 14,
  },
};
