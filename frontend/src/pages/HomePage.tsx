import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MemoComposer } from '../components/MemoComposer';
import { MemoTimeline } from '../components/MemoTimeline';
import { SidebarShell } from '../components/SidebarShell';
import { TimelineHeader } from '../components/TimelineHeader';
import type { SortMode } from '../components/TimelineHeader';
import { TopBar } from '../components/TopBar';
import { StatsView } from '../components/StatsView';
import { AiConfigModal } from '../components/AiConfigModal';
import { ImportExportModal } from '../components/ImportExportModal';
import { createMemo, deleteMemo, fetchDashboardCalendar, fetchDashboardMemos, fetchDashboardStats, fetchDashboardTags, fetchMe, fetchPublicCalendar, fetchPublicMemos, fetchPublicStats, fetchPublicTags, logout, pinMemo as pinMemoApi, restoreMemo, unpinMemo as unpinMemoApi, updateMemo } from '../lib/api';
import type { CalendarResponse, DashboardStatsResponse, MeResponse, PublicStatsResponse } from '../lib/api';
import { buildTagTree } from '../lib/tag-tree';
import type { MemoFilters } from '../components/SidebarShell';
import { useTheme, colors } from '../lib/theme';
import type { PublicMemosResponse } from '../types/shared';

const MOBILE_BREAKPOINT = 768;

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
  const isMobile = useIsMobile();
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'all' | 'private' | 'trash' | 'onThisDay' | 'dailyReview' | 'stats'>('all');
  const [reviewSeed, setReviewSeed] = useState(0);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [filters, setFilters] = useState<MemoFilters>({});
  const [sortMode, setSortMode] = useState<SortMode>('display-desc');
  const [showImportExport, setShowImportExport] = useState(false);
  const [showAiConfig, setShowAiConfig] = useState(false);

  // Sync sidebar default when crossing breakpoint
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

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

  const handleSelectView = (view: 'all' | 'private' | 'trash' | 'onThisDay' | 'dailyReview' | 'stats') => {
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

  const { data: me, isLoading: isLoadingMe } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => fetchMe(),
  });

  const isAuthor = me?.authenticated && me.role === 'author';

  const apiView = activeView === 'private' ? 'private' : activeView === 'trash' ? 'trash' : 'public';

  const { data, isLoading } = useQuery<PublicMemosResponse | { memos: PublicMemosResponse['memos'] }>({
    queryKey: isAuthor ? ['dashboard-memos', apiView, selectedDate] : ['public-memos', selectedDate],
    queryFn: () => {
      if (isAuthor) {
        return fetchDashboardMemos(apiView as 'all' | 'public' | 'private' | 'draft' | 'trash', selectedDate ?? undefined);
      }
      return fetchPublicMemos(undefined, selectedDate ?? undefined);
    },
    enabled: !isLoadingMe,
    placeholderData: (prev) => prev,
  });

  const { data: tagsData } = useQuery({
    queryKey: isAuthor ? ['dashboard-tags'] : ['public-tags'],
    queryFn: () => (isAuthor ? fetchDashboardTags() : fetchPublicTags()),
    enabled: !isLoadingMe,
  });

  const { data: publicStatsData } = useQuery<PublicStatsResponse>({
    queryKey: ['public-stats'],
    queryFn: fetchPublicStats,
    enabled: !isLoadingMe && !isAuthor,
  });

  const { data: calendarData } = useQuery<CalendarResponse>({
    queryKey: isAuthor ? ['dashboard-calendar'] : ['public-calendar'],
    queryFn: () => (isAuthor ? fetchDashboardCalendar() : fetchPublicCalendar()),
    enabled: !isLoadingMe,
  });

  const { data: statsData } = useQuery<DashboardStatsResponse>({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    enabled: !isLoadingMe && isAuthor,
  });

  const createMemoMutation = useMutation({
    mutationFn: (input: { content: string; visibility: 'public' | 'private' | 'draft'; displayDate: string }) =>
      createMemo(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
    },
  });

  const updateMemoMutation = useMutation({
    mutationFn: (vars: { id: number; input: { content?: string; visibility?: 'public' | 'private' | 'draft'; displayDate?: string } }) =>
      updateMemo(vars.id, vars.input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
    },
  });

  const deleteMemoMutation = useMutation({
    mutationFn: (id: number) => deleteMemo(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });

  const restoreMemoMutation = useMutation({
    mutationFn: (id: number) => restoreMemo(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => pinMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] }); },
  });
  const unpinMutation = useMutation({
    mutationFn: (id: number) => unpinMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] }); },
  });

  const todayMonthDay = new Date().toISOString().slice(5, 10);
  const todayYear = new Date().getFullYear().toString();

  const memos = useMemo(() => {
    if ((activeView === 'trash' || activeView === 'private') && !isAuthor) return [];
    let all = data?.memos ?? [];
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
    if (activeView === 'all' && !activeTag) {
      sorted.sort((a, b) => {
        const ap = a.pinnedAt ? 1 : 0;
        const bp = b.pinnedAt ? 1 : 0;
        return bp - ap;
      });
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, activeTag, activeView, filters, todayMonthDay, todayYear, reviewSeed, sortMode]);

  if (isLoading || isLoadingMe) {
    return <div style={styles.loading}>Loading...</div>;
  }

  const allTags: Array<{ tag: string; count: number }> = Array.isArray(tagsData?.tags) ? tagsData.tags : [];
  const tagTree = buildTagTree(allTags);
  const todayStr = new Date().toISOString().slice(0, 10);

  const pageStyle: React.CSSProperties = { ...styles.page, background: c.pageBg, color: c.textPrimary };
  const sidebarMobileOpen: React.CSSProperties = { ...styles.sidebarMobileOpen, background: c.sidebarBg };
  const sidebarStyle: React.CSSProperties = isMobile
    ? { ...styles.sidebar, ...(sidebarOpen ? sidebarMobileOpen : styles.sidebarMobileClosed) }
    : { ...styles.sidebar, ...(sidebarOpen ? {} : { display: 'none' }) };

  return (
    <div style={pageStyle}>
      {showImportExport && (
        <ImportExportModal
          onClose={() => setShowImportExport(false)}
          onImportDone={async () => {
            await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
            await queryClient.invalidateQueries({ queryKey: ['dashboard-tags'] });
            await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
          }}
        />
      )}
      {showAiConfig && (
        <AiConfigModal onClose={() => setShowAiConfig(false)} />
      )}
      {isMobile && sidebarOpen && (
        <div style={{ ...styles.overlay, background: c.overlay }} onClick={() => setSidebarOpen(false)} />
      )}
      <div style={sidebarStyle}>
        <SidebarShell
          memoCount={isAuthor ? (statsData?.stats.public ?? memos.length) : (publicStatsData?.stats.total ?? memos.length)}
          tagCount={isAuthor ? (statsData?.stats.tags ?? allTags.length) : (publicStatsData?.stats.tags ?? allTags.length)}
          streakDays={isAuthor ? (statsData?.stats.streakDays ?? 0) : (publicStatsData?.stats.streakDays ?? 0)}
          activeDate={selectedDate}
          calendarDays={calendarData?.days ?? []}
          activeView={activeView}
          activeTag={activeTag}
          filters={filters}
          tagTree={tagTree}
          style={isMobile ? { minHeight: 0, flex: '1 1 0', overflowY: 'auto' as const } : undefined}
          onSelectView={handleSelectView}
          onSelectDate={handleSelectDate}
          onSelectTag={handleSelectTag}
          onChangeFilters={setFilters}
          authenticated={Boolean(isAuthor)}
          githubLogin={me?.githubLogin ?? null}
          onLogout={async () => { await logout(); window.location.assign('/'); }}
        />
      </div>
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
        />
        {activeView === 'stats' ? (
          <StatsView isAuthor={Boolean(isAuthor)} />
        ) : (
          <>
            {isAuthor ? <MemoComposer defaultDisplayDate={todayStr} existingTags={allTags} onSubmit={async (input) => {
              await createMemoMutation.mutateAsync(input);
            }} /> : <div style={{ ...styles.loginHint, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>登录后发布 memo</div>}
            {activeView === 'trash' && !isAuthor && (
              <div style={{ ...styles.loginHint, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>登录后查看已删除的笔记</div>
            )}
            {activeView === 'private' && !isAuthor && (
              <div style={{ ...styles.loginHint, background: c.cardBg, borderColor: c.borderMedium, color: c.textMuted }}>登录后查看私密笔记</div>
            )}
            {activeView === 'trash' && isAuthor && (
              <div style={{ ...styles.trashNotice, color: c.textMuted }}>回收站内的笔记仅保留 30 天</div>
            )}
            <TimelineHeader count={memos.length} sortMode={sortMode} onSortChange={setSortMode} />
            <MemoTimeline
              memos={memos}
              isAuthor={Boolean(isAuthor)}
              isTrash={activeView === 'trash'}
              allTags={allTags.map((t) => t.tag)}
              onOpenMemo={(memo) => window.location.assign(`/memos/${memo.slug}`)}
              onOpenTag={(tag) => window.location.assign(`/tags/${tag}`)}
              onEditMemo={(memo) => window.location.assign(`/memos/${memo.slug}/edit`)}
              onRestoreMemo={(memo) => {
                restoreMemoMutation.mutate(memo.id);
              }}
              onDeleteMemo={(memo) => {
                deleteMemoMutation.mutate(memo.id);
              }}
              onChangeVisibility={(memo, visibility) => {
                updateMemoMutation.mutate({ id: memo.id, input: { visibility } });
              }}
              onFillTagsMemo={(id, newContent) => {
                updateMemoMutation.mutate({ id, input: { content: newContent } });
              }}
              onPinMemo={(memo) => {
                if (memo.pinnedAt) {
                  unpinMutation.mutate(memo.id);
                } else {
                  pinMutation.mutate(memo.id);
                }
              }}
            />
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
};
