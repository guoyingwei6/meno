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
  onEditMemo?: (memo: MemoSummary) => void;
  onRestoreMemo?: (memo: MemoSummary) => void;
  onChangeVisibility?: (memo: MemoSummary, visibility: 'public' | 'private') => void;
  onDeleteMemo?: (memo: MemoSummary) => void;
  onFillTagsMemo?: (id: number, newContent: string) => void;
  onPinMemo?: (memo: MemoSummary) => void;
  onFavoriteMemo?: (memo: MemoSummary) => void;
}

export const MemoTimeline = ({ memos, isAuthor, isTrash, allTags, onOpenMemo, onOpenTag, onEditMemo, onRestoreMemo, onChangeVisibility, onDeleteMemo, onFillTagsMemo, onPinMemo, onFavoriteMemo }: MemoTimelineProps) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, memos.length));
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [memos.length]);

  const visible = memos.slice(0, visibleCount);

  return (
    <section style={styles.timeline}>
      {visible.map((memo) => (
        <MemoCard key={memo.id} memo={memo} isAuthor={isAuthor} isTrash={isTrash} allTags={allTags} onOpen={onOpenMemo} onOpenTag={onOpenTag} onEdit={onEditMemo} onRestore={onRestoreMemo} onChangeVisibility={onChangeVisibility} onDelete={onDeleteMemo} onFillTags={onFillTagsMemo} onPin={onPinMemo} onFavorite={onFavoriteMemo} />
      ))}
      {visibleCount < memos.length && <div ref={sentinelRef} style={styles.sentinel} />}
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
};
