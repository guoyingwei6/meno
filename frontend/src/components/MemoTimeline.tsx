import { useEffect, useRef, useState } from 'react';
import type { MemoSummary } from '../types/shared';
import { MemoCard } from './MemoCard';

const PAGE_SIZE = 20;

interface MemoTimelineProps {
  memos: MemoSummary[];
  isAuthor?: boolean;
  isTrash?: boolean;
  allTags?: string[];
  onOpenMemo?: (memo: MemoSummary) => void;
  onOpenTag?: (tag: string) => void;
  onSaveEditMemo?: (memo: MemoSummary, input: { content: string; visibility: 'public' | 'private'; displayDate: string }) => void;
  onRestoreMemo?: (memo: MemoSummary) => void;
  onChangeVisibility?: (memo: MemoSummary, visibility: 'public' | 'private') => void;
  onDeleteMemo?: (memo: MemoSummary) => void;
  onFillTagsMemo?: (id: number, newContent: string) => void;
  onPinMemo?: (memo: MemoSummary) => void;
  onFavoriteMemo?: (memo: MemoSummary) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export const MemoTimeline = ({ memos, isAuthor, isTrash, allTags, onOpenMemo, onOpenTag, onSaveEditMemo, onRestoreMemo, onChangeVisibility, onDeleteMemo, onFillTagsMemo, onPinMemo, onFavoriteMemo, hasMore, isLoadingMore, onLoadMore }: MemoTimelineProps) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const usesServerPaging = Boolean(onLoadMore);

  // Reset when memos change (filter/view switch)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [memos]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (usesServerPaging) {
            if (hasMore && !isLoadingMore) onLoadMore?.();
            return;
          }
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, memos.length));
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, memos.length, onLoadMore, usesServerPaging]);

  const visible = usesServerPaging ? memos : memos.slice(0, visibleCount);
  const shouldShowSentinel = usesServerPaging ? Boolean(hasMore) : visibleCount < memos.length;

  return (
    <section style={styles.timeline}>
      {visible.map((memo) => (
        <MemoCard key={memo.id} memo={memo} isAuthor={isAuthor} isTrash={isTrash} allTags={allTags} onOpen={onOpenMemo} onOpenTag={onOpenTag} onSaveEdit={onSaveEditMemo} onRestore={onRestoreMemo} onChangeVisibility={onChangeVisibility} onDelete={onDeleteMemo} onFillTags={onFillTagsMemo} onPin={onPinMemo} onFavorite={onFavoriteMemo} />
      ))}
      {shouldShowSentinel && <div ref={sentinelRef} style={styles.sentinel} />}
      {isLoadingMore ? <div style={styles.loadingMore}>加载更多...</div> : null}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sentinel: {
    height: 1,
  },
  loadingMore: {
    padding: '8px 0',
    textAlign: 'center',
    color: '#999',
    fontSize: 13,
  },
};
