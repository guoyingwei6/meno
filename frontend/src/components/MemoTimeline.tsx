import type { MemoSummary } from '../types/shared';
import { MemoCard } from './MemoCard';

interface MemoTimelineProps {
  memos: MemoSummary[];
  isAuthor?: boolean;
  onOpenMemo?: (memo: MemoSummary) => void;
  onOpenTag?: (tag: string) => void;
  onEditMemo?: (memo: MemoSummary) => void;
  onChangeVisibility?: (memo: MemoSummary, visibility: 'public' | 'private') => void;
  onDeleteMemo?: (memo: MemoSummary) => void;
}

export const MemoTimeline = ({ memos, isAuthor, onOpenMemo, onOpenTag, onEditMemo, onChangeVisibility, onDeleteMemo }: MemoTimelineProps) => {
  return (
    <section style={styles.timeline}>
      {memos.map((memo) => (
        <MemoCard key={memo.id} memo={memo} isAuthor={isAuthor} onOpen={onOpenMemo} onOpenTag={onOpenTag} onEdit={onEditMemo} onChangeVisibility={onChangeVisibility} onDelete={onDeleteMemo} />
      ))}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
};
