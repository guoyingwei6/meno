import { useState } from 'react';
import type { TagTreeResult } from '../lib/tag-tree';

interface DateCount {
  date: string;
  count: number;
}

export interface MemoFilters {
  visibility?: 'public' | 'private' | null;
  hasTags?: boolean | null;
  hasImages?: boolean | null;
}

interface SidebarShellProps {
  memoCount: number;
  tagCount: number;
  streakDays?: number;
  activeDate?: string | null;
  calendarDays?: DateCount[];
  activeView?: 'all' | 'trash' | 'onThisDay';
  activeTag?: string | null;
  filters?: MemoFilters;
  tagTree?: TagTreeResult;
  onSelectView?: (view: 'all' | 'trash' | 'onThisDay') => void;
  onSelectDate?: (date: string) => void;
  onSelectTag?: (tag: string | null) => void;
  onChangeFilters?: (filters: MemoFilters) => void;
}

/** Icon cell: shows icon normally, ▾ arrow on hover. Clicking toggles expand. */
const IconCell = ({ icon, expanded, onToggle }: { icon: string; expanded: boolean; onToggle: () => void }) => {
  const [hovered, setHovered] = useState(false);
  const arrow = expanded ? '▾' : '▸';
  return (
    <button
      type="button"
      style={styles.iconCell}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: hovered ? 10 : 14, color: hovered ? '#999' : '#888' }}>
        {hovered ? arrow : icon}
      </span>
    </button>
  );
};

const getMonthDays = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfWeek = (year: number, month: number) => new Date(year, month, 1).getDay();

export const SidebarShell = ({ memoCount, tagCount, streakDays = 0, activeDate = null, calendarDays = [], activeView = 'all', activeTag = null, filters = {}, tagTree = { groups: [], flat: [] }, onSelectView, onSelectDate, onSelectTag, onChangeFilters }: SidebarShellProps) => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [tagsCollapsed, setTagsCollapsed] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const daysInMonth = getMonthDays(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);
  const countMap = new Map(calendarDays.map((d) => [d.date, d.count]));

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };

  const monthLabel = `${viewYear}年${viewMonth + 1}月`;
  const isNotesActive = activeView === 'all';

  const toggleVisibility = () => {
    const current = filters.visibility;
    const next = current === 'public' ? 'private' : current === 'private' ? null : 'public';
    onChangeFilters?.({ ...filters, visibility: next });
  };
  const toggleTags = () => {
    const current = filters.hasTags;
    const next = current === true ? false : current === false ? null : true;
    onChangeFilters?.({ ...filters, hasTags: next });
  };
  const toggleImages = () => {
    const current = filters.hasImages;
    const next = current === true ? false : current === false ? null : true;
    onChangeFilters?.({ ...filters, hasImages: next });
  };

  const visLabel = filters.visibility === 'public' ? '公开' : filters.visibility === 'private' ? '私密' : '公开/私密';
  const tagFilterLabel = filters.hasTags === true ? '有标签' : filters.hasTags === false ? '无标签' : '有/无标签';
  const imgLabel = filters.hasImages === true ? '有图片' : filters.hasImages === false ? '无图片' : '有/无图片';

  return (
    <aside style={styles.sidebar}>
      <div>
        <div style={styles.brandRow}>
          <h1 style={styles.brand}>Meno</h1>
        </div>
        <div style={styles.statsGrid}>
          <div><div style={styles.statNumber}>{memoCount}</div><div style={styles.statLabel}>笔记</div></div>
          <div><div style={styles.statNumber}>{tagCount}</div><div style={styles.statLabel}>标签</div></div>
          <div><div style={styles.statNumber}>{streakDays}</div><div style={styles.statLabel}>天</div></div>
        </div>
      </div>

      <div style={styles.calendarCard}>
        <div style={styles.calendarHeader}>
          <button type="button" style={styles.arrowButton} onClick={prevMonth}>{'<'}</button>
          <strong style={{ fontSize: 14 }}>{monthLabel}</strong>
          <button type="button" style={styles.arrowButton} onClick={nextMonth}>{'>'}</button>
        </div>
        <div style={styles.weekRow}>
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
            <span key={day} style={styles.weekDay}>{day}</span>
          ))}
        </div>
        <div style={styles.calendarGrid}>
          {Array.from({ length: firstDow }).map((_, i) => (
            <span key={`pad-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const date = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isActive = activeDate === date;
            const count = countMap.get(date) ?? 0;
            const isToday = date === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            let bg = '#fff';
            if (isActive) bg = '#31d266';
            else if (count >= 3) bg = '#6ee09a';
            else if (count >= 2) bg = '#a3ebc0';
            else if (count >= 1) bg = '#d4f5e0';

            const color = isActive ? '#fff' : count > 0 ? '#1a7a3a' : '#444';
            const fontWeight = isActive || count > 0 || isToday ? 700 : 400;

            return (
              <button
                key={day}
                type="button"
                aria-label={`${day}日`}
                aria-pressed={isActive}
                onClick={() => onSelectDate?.(date)}
                style={{
                  ...styles.dayCellButton,
                  background: bg,
                  color,
                  fontWeight,
                  border: isToday && !isActive ? '2px solid #ccc' : 'none',
                }}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <nav style={styles.nav}>
        <div style={styles.navRow}>
          <IconCell icon="📋" expanded={notesExpanded} onToggle={() => setNotesExpanded((v) => !v)} />
          <button type="button" style={{ ...styles.navButton, ...(isNotesActive ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('all')}>全部笔记</button>
        </div>
        {notesExpanded && (
          <div style={styles.navSubItems}>
            <button type="button" style={{ ...styles.filterChip, ...(filters.visibility != null ? styles.filterChipActive : {}) }} onClick={toggleVisibility}>{visLabel}</button>
            <button type="button" style={{ ...styles.filterChip, ...(filters.hasTags != null ? styles.filterChipActive : {}) }} onClick={toggleTags}>{tagFilterLabel}</button>
            <button type="button" style={{ ...styles.filterChip, ...(filters.hasImages != null ? styles.filterChipActive : {}) }} onClick={toggleImages}>{imgLabel}</button>
          </div>
        )}
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>✨</span>
          <button type="button" style={{ ...styles.navButton, ...(activeView === 'onThisDay' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('onThisDay')}>那年今日</button>
        </div>
      </nav>

      <div style={styles.tagSection}>
        <button type="button" style={styles.allTagsButton} onClick={() => setTagsCollapsed((v) => !v)}>
          <span style={{ fontSize: 10, color: '#d4a34d', display: 'inline-block', transition: 'transform 0.15s', transform: tagsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
          {' '}全部标签
        </button>
        {!tagsCollapsed && tagTree.groups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.label);
          const groupTag = group.label;
          const isGroupActive = activeTag === groupTag;
          return (
            <div key={group.label} style={styles.tagGroup}>
              <div style={styles.navRow}>
                <IconCell icon="#" expanded={!isCollapsed} onToggle={() => toggleGroup(group.label)} />
                <button type="button" style={{ ...styles.tagNameButton, ...(isGroupActive ? styles.tagNameActive : {}) }} onClick={() => onSelectTag?.(isGroupActive ? null : groupTag)}>
                  <span>{group.label}</span>
                  <span style={{ ...styles.tagCount, ...(isGroupActive ? { color: '#fff' } : {}) }}>{group.count}</span>
                </button>
              </div>
              {!isCollapsed && (
                <div style={styles.tagChildren}>
                  {group.children.map((child) => {
                    const childTag = `${group.label}/${child.name}`;
                    const isChildActive = activeTag === childTag;
                    return (
                      <button key={child.name} type="button" style={{ ...styles.tagTreeButton, ...(isChildActive ? styles.tagNameActive : {}) }} onClick={() => onSelectTag?.(isChildActive ? null : childTag)}>
                        <span># {child.name}</span>
                        <span style={{ ...styles.tagCount, ...(isChildActive ? { color: '#fff' } : {}) }}>{child.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {!tagsCollapsed && tagTree.flat.map((item) => {
          const isItemActive = activeTag === item.name;
          return (
            <div key={item.name} style={styles.navRow}>
              <span style={styles.iconCellStatic}>#</span>
              <button type="button" style={{ ...styles.tagNameButton, ...(isItemActive ? styles.tagNameActive : {}) }} onClick={() => onSelectTag?.(isItemActive ? null : item.name)}>
                <span>{item.name}</span>
                <span style={{ ...styles.tagCount, ...(isItemActive ? { color: '#fff' } : {}) }}>{item.count}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div style={styles.trashWrap}>
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>🗑️</span>
          <button type="button" style={{ ...styles.navButton, ...(activeView === 'trash' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('trash')}>回收站</button>
        </div>
      </div>
    </aside>
  );
};

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 280,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    padding: '20px 16px',
    borderRight: '1px solid #f0f0f0',
    background: '#fbfbfb',
    minHeight: '100vh',
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  brand: {
    fontSize: 28,
    lineHeight: 1,
    margin: 0,
    fontWeight: 800,
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 4,
    background: '#e8e8e8',
    color: '#666',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 700,
  },
  statLabel: {
    color: '#999',
    fontSize: 12,
  },
  calendarCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  calendarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  arrowButton: {
    border: 'none',
    background: 'transparent',
    fontSize: 16,
    cursor: 'pointer',
    color: '#666',
    padding: '4px 8px',
  },
  weekRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  weekDay: {
    fontSize: 11,
    color: '#aaa',
    textAlign: 'center',
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  dayCellButton: {
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  navRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
  },
  iconCell: {
    width: 32,
    height: 32,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0,
  },
  iconCellStatic: {
    width: 32,
    height: 32,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    color: '#888',
  },
  navButton: {
    flex: 1,
    border: 'none',
    borderRadius: 8,
    padding: '10px 12px',
    textAlign: 'left',
    background: 'transparent',
    color: '#444',
    cursor: 'pointer',
    fontSize: 14,
  },
  navButtonPrimary: {
    background: '#31d266',
    color: '#fff',
    fontWeight: 600,
  },
  navSubItems: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    paddingLeft: 32,
    paddingBottom: 4,
  },
  filterChip: {
    border: '1px solid #e0e0e0',
    borderRadius: 14,
    padding: '4px 10px',
    background: '#fff',
    color: '#888',
    cursor: 'pointer',
    fontSize: 12,
  },
  filterChipActive: {
    background: '#31d266',
    color: '#fff',
    borderColor: '#31d266',
    fontWeight: 600,
  },
  tagSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  allTagsButton: {
    border: 'none',
    background: 'transparent',
    color: '#d4a34d',
    textAlign: 'left',
    padding: '0 0 4px',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 13,
  },
  tagGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  tagNameButton: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    color: '#666',
    padding: '6px 8px',
    fontSize: 13,
    borderRadius: 6,
  },
  tagNameActive: {
    background: '#31d266',
    color: '#fff',
    fontWeight: 600,
  },
  tagChildren: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingLeft: 32,
  },
  tagTreeButton: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    color: '#666',
    padding: '6px 8px',
    fontSize: 13,
    width: '100%',
    borderRadius: 6,
  },
  tagCount: {
    color: '#bbb',
    fontSize: 12,
    fontWeight: 400,
    marginLeft: 8,
  },
  trashWrap: {
  },
};
