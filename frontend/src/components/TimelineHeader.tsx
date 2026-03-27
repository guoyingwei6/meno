import { useState } from 'react';
import { useTheme, colors } from '../lib/theme';

export type SortMode = 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc';

const SORT_LABELS: Record<SortMode, string> = {
  'created-desc': '创建时间，从新到旧',
  'created-asc': '创建时间，从旧到新',
  'updated-desc': '编辑时间，从新到旧',
  'updated-asc': '编辑时间，从旧到新',
};

interface TimelineHeaderProps {
  count: number;
  sortMode?: SortMode;
  onSortChange?: (mode: SortMode) => void;
}

export const TimelineHeader = ({ count, sortMode = 'created-desc', onSortChange }: TimelineHeaderProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [open, setOpen] = useState(false);

  return (
    <div style={styles.wrap}>
      <div style={{ ...styles.title, color: c.textMuted }}>笔记（{count}）</div>
      <div style={styles.sortWrap}>
        <button
          type="button"
          style={{ ...styles.sortButton, color: c.textMuted }}
          onClick={() => setOpen((v) => !v)}
        >
          <span style={styles.sortIcon}>↕</span>
          {SORT_LABELS[sortMode]}
        </button>
        {open && (
          <>
            <div style={styles.backdrop} onClick={() => setOpen(false)} />
            <div style={{ ...styles.dropdown, background: c.cardBg, borderColor: c.border }}>
              {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  style={{
                    ...styles.dropdownItem,
                    color: mode === sortMode ? '#31d266' : c.textSecondary,
                    fontWeight: mode === sortMode ? 600 : 400,
                  }}
                  onClick={() => { onSortChange?.(mode); setOpen(false); }}
                >
                  {SORT_LABELS[mode]}
                  {mode === sortMode && <span style={styles.check}>✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: '8px 0 12px',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
  },
  sortWrap: {
    position: 'relative',
  },
  sortButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    borderRadius: 6,
  },
  sortIcon: {
    fontSize: 14,
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9,
  },
  dropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    marginTop: 4,
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    zIndex: 10,
    minWidth: 200,
    padding: '4px 0',
  },
  dropdownItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '10px 14px',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  check: {
    color: '#31d266',
    fontSize: 14,
    fontWeight: 700,
  },
};
