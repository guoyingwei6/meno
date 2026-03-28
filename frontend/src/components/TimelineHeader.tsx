import { useState } from 'react';
import { useTheme, colors } from '../lib/theme';

export type SortField = 'display' | 'created' | 'updated';
export type SortDir = 'desc' | 'asc';
export type SortMode = `${SortField}-${SortDir}`;

const FIELD_LABELS: Record<SortField, string> = {
  display: '展示时间',
  created: '创建时间',
  updated: '编辑时间',
};

const SORT_FIELDS: SortField[] = ['display', 'created', 'updated'];

function parseMode(mode: SortMode): { field: SortField; dir: SortDir } {
  const lastDash = mode.lastIndexOf('-');
  return { field: mode.slice(0, lastDash) as SortField, dir: mode.slice(lastDash + 1) as SortDir };
}

interface TimelineHeaderProps {
  count: number;
  sortMode?: SortMode;
  onSortChange?: (mode: SortMode) => void;
}

export const TimelineHeader = ({ count, sortMode = 'display-desc', onSortChange }: TimelineHeaderProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [open, setOpen] = useState(false);
  const { field: activeField, dir: activeDir } = parseMode(sortMode);

  const handleFieldClick = (field: SortField) => {
    if (field === activeField) {
      onSortChange?.(`${field}-${activeDir === 'desc' ? 'asc' : 'desc'}`);
    } else {
      onSortChange?.(`${field}-desc`);
    }
    setOpen(false);
  };

  return (
    <div style={styles.wrap}>
      <div style={{ ...styles.title, color: c.textMuted }}>笔记（{count}）</div>
      <div style={styles.sortWrap}>
        <button
          type="button"
          style={{ ...styles.sortButton, color: c.textMuted }}
          onClick={() => setOpen((v) => !v)}
        >
          <span style={styles.sortIcon}>{activeDir === 'desc' ? '↓' : '↑'}</span>
          {FIELD_LABELS[activeField]}
        </button>
        {open && (
          <>
            <div style={styles.backdrop} onClick={() => setOpen(false)} />
            <div style={{ ...styles.dropdown, background: c.cardBg, borderColor: c.border }}>
              {SORT_FIELDS.map((field) => {
                const isActive = field === activeField;
                return (
                  <button
                    key={field}
                    type="button"
                    style={{
                      ...styles.dropdownItem,
                      color: isActive ? '#31d266' : c.textSecondary,
                      fontWeight: isActive ? 600 : 400,
                    }}
                    onClick={() => handleFieldClick(field)}
                  >
                    {FIELD_LABELS[field]}
                    {isActive && (
                      <span style={styles.arrow}>{activeDir === 'desc' ? '↓' : '↑'}</span>
                    )}
                  </button>
                );
              })}
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
    minWidth: 160,
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
  arrow: {
    color: '#31d266',
    fontSize: 14,
    fontWeight: 700,
  },
};
