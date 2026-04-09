import { useEffect, useState } from 'react';
import type { TagTreeResult } from '../lib/tag-tree';
import { useTheme, colors } from '../lib/theme';

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
  activeView?: 'all' | 'private' | 'trash' | 'onThisDay' | 'dailyReview' | 'stats' | 'favorited' | 'deepChat';
  activeTag?: string | null;
  filters?: MemoFilters;
  tagTree?: TagTreeResult;
  hasOnThisDay?: boolean;
  style?: React.CSSProperties;
  onSelectView?: (view: 'all' | 'private' | 'trash' | 'onThisDay' | 'dailyReview' | 'stats' | 'favorited' | 'deepChat') => void;
  onSelectDate?: (date: string) => void;
  onSelectTag?: (tag: string | null) => void;
  onChangeFilters?: (filters: MemoFilters) => void;
  authenticated?: boolean;
  githubLogin?: string | null;
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tag: string, deleteNotes: boolean) => void;
  onLogout?: () => void;
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

export const SidebarShell = ({ memoCount, tagCount, streakDays = 0, activeDate = null, calendarDays = [], activeView = 'all', activeTag = null, filters = {}, tagTree = { groups: [], flat: [] }, hasOnThisDay = false, style, onSelectView, onSelectDate, onSelectTag, onChangeFilters, authenticated, githubLogin, onRenameTag, onDeleteTag, onLogout }: SidebarShellProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [tagsCollapsed, setTagsCollapsed] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState<string | null>(null);
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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

  useEffect(() => {
    if (!tagMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest('[data-tag-menu-root="true"]')) {
        setTagMenuOpen(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [tagMenuOpen]);

  useEffect(() => {
    if (!renameTag && !deleteConfirm) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRenameTag(null);
        setRenameValue('');
        setDeleteConfirm(null);
        return;
      }

      if (event.key === 'Enter' && renameTag) {
        const nextTag = renameValue.trim();
        if (nextTag && nextTag !== renameTag) {
          onRenameTag?.(renameTag, nextTag);
          setRenameTag(null);
          setRenameValue('');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirm, onRenameTag, renameTag, renameValue]);

  const openRenameDialog = (tag: string) => {
    setTagMenuOpen(null);
    setDeleteConfirm(null);
    setRenameTag(tag);
    setRenameValue(tag);
  };

  const openDeleteDialog = (tag: string) => {
    setTagMenuOpen(null);
    setRenameTag(null);
    setRenameValue('');
    setDeleteConfirm(tag);
  };

  const confirmRename = () => {
    const nextTag = renameValue.trim();
    if (!renameTag || !nextTag || nextTag === renameTag) {
      return;
    }

    onRenameTag?.(renameTag, nextTag);
    setRenameTag(null);
    setRenameValue('');
  };

  const confirmDelete = (deleteNotes: boolean) => {
    if (!deleteConfirm) {
      return;
    }

    onDeleteTag?.(deleteConfirm, deleteNotes);
    setDeleteConfirm(null);
  };

  const renderTagActions = (tag: string) => {
    if (!authenticated) {
      return null;
    }

    const isOpen = tagMenuOpen === tag;
    return (
      <div data-tag-menu-root="true" style={styles.tagMenuWrap}>
        <button
          type="button"
          aria-label={`管理标签 ${tag}`}
          style={{ ...styles.tagMenuButton, color: c.textMuted }}
          onClick={(event) => {
            event.stopPropagation();
            setTagMenuOpen((current) => (current === tag ? null : tag));
          }}
        >
          ···
        </button>
        {isOpen && (
          <div style={{ ...styles.tagMenuDropdown, background: c.cardBg, borderColor: c.borderMedium, boxShadow: isDark ? '0 12px 24px rgba(0,0,0,0.35)' : '0 12px 24px rgba(0,0,0,0.12)' }}>
            <button type="button" style={{ ...styles.tagMenuItem, color: c.textPrimary }} onClick={(event) => { event.stopPropagation(); openRenameDialog(tag); }}>重命名</button>
            <button type="button" style={{ ...styles.tagMenuItem, color: '#e53e3e' }} onClick={(event) => { event.stopPropagation(); openDeleteDialog(tag); }}>删除标签</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside style={{ ...styles.sidebar, background: c.sidebarBg, borderRightColor: c.border, color: c.textPrimary, ...style }}>
      <div>
        <div style={styles.brandRow}>
          <h1 style={styles.brand}>Meno</h1>
          {authenticated && githubLogin && (
            <div style={styles.accountRow}>
              <span style={{ fontSize: 13, color: c.textMuted, fontWeight: 500 }}>@{githubLogin}</span>
              <button type="button" style={{ ...styles.logoutButton, borderColor: c.borderMedium, color: c.textMuted, background: c.cardBg }} onClick={onLogout}>退出</button>
            </div>
          )}
        </div>
        <div style={styles.statsGrid}>
          <button type="button" style={styles.statButton} onClick={() => onSelectView?.('stats')}><div style={styles.statNumber}>{memoCount}</div><div style={styles.statLabel}>笔记</div></button>
          <button type="button" style={styles.statButton} onClick={() => onSelectView?.('stats')}><div style={styles.statNumber}>{tagCount}</div><div style={styles.statLabel}>标签</div></button>
          <button type="button" style={styles.statButton} onClick={() => onSelectView?.('stats')}><div style={styles.statNumber}>{streakDays}</div><div style={styles.statLabel}>天</div></button>
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

            let bg = isDark ? '#333' : '#fff';
            if (isActive) bg = c.accent;
            else if (count >= 3) bg = isDark ? '#2a6e3a' : '#6ee09a';
            else if (count >= 2) bg = isDark ? '#245a30' : '#a3ebc0';
            else if (count >= 1) bg = c.accentLight;

            const color = isActive ? '#fff' : c.textSecondary;
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
          <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(isNotesActive ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('all')}>全部笔记</button>
        </div>
        {notesExpanded && (
          <div style={styles.navSubItems}>
            <button type="button" style={{ ...styles.filterChip, color: c.textSecondary, ...(filters.hasTags != null ? styles.filterChipActive : {}) }} onClick={toggleTags}>{tagFilterLabel}</button>
            <button type="button" style={{ ...styles.filterChip, color: c.textSecondary, ...(filters.hasImages != null ? styles.filterChipActive : {}) }} onClick={toggleImages}>{imgLabel}</button>
          </div>
        )}
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>⭐</span>
          <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(activeView === 'favorited' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('favorited')}>收藏笔记</button>
        </div>
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>🔒</span>
          <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(activeView === 'private' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('private')}>私密笔记</button>
        </div>
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>✨</span>
          <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(activeView === 'onThisDay' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('onThisDay')}>那年今日{hasOnThisDay && activeView !== 'onThisDay' && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#31d266', marginLeft: 6, verticalAlign: 'middle' }} />}</button>
        </div>
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>🎲</span>
          <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(activeView === 'dailyReview' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('dailyReview')}>每日回顾</button>
        </div>
        {authenticated && (
          <div style={styles.navRow}>
            <span style={styles.iconCellStatic}>✦</span>
            <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(activeView === 'deepChat' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('deepChat')}>深度对话</button>
          </div>
        )}
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>📊</span>
          <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(activeView === 'stats' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('stats')}>记录统计</button>
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
                {renderTagActions(groupTag)}
              </div>
              {!isCollapsed && (
                <div style={styles.tagChildren}>
                  {group.children.map((child) => {
                    const childTag = `${group.label}/${child.name}`;
                    const isChildActive = activeTag === childTag;
                    return (
                      <div key={child.name} style={styles.navRow}>
                        <button type="button" style={{ ...styles.tagTreeButton, ...(isChildActive ? styles.tagNameActive : {}) }} onClick={() => onSelectTag?.(isChildActive ? null : childTag)}>
                          <span># {child.name}</span>
                          <span style={{ ...styles.tagCount, ...(isChildActive ? { color: '#fff' } : {}) }}>{child.count}</span>
                        </button>
                        {renderTagActions(childTag)}
                      </div>
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
              {renderTagActions(item.name)}
            </div>
          );
        })}
      </div>

      <div style={styles.trashWrap}>
        <div style={styles.navRow}>
          <span style={styles.iconCellStatic}>🗑️</span>
          <button type="button" style={{ ...styles.navButton, color: c.textSecondary, ...(activeView === 'trash' ? styles.navButtonPrimary : {}) }} onClick={() => onSelectView?.('trash')}>回收站</button>
        </div>
      </div>

      {renameTag && (
        <div style={{ ...styles.modalOverlay, background: isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(17, 24, 39, 0.35)' }} onClick={() => { setRenameTag(null); setRenameValue(''); }}>
          <div style={{ ...styles.modalCard, background: c.cardBg, borderColor: c.border }} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ ...styles.modalTitle, color: c.textPrimary }}>重命名标签</h3>
            <p style={{ ...styles.modalBody, color: c.textMuted }}>将标签“{renameTag}”重命名为：</p>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              style={{ ...styles.modalInput, background: isDark ? '#141414' : '#fff', borderColor: c.borderMedium, color: c.textPrimary }}
            />
            <div style={styles.modalActions}>
              <button type="button" style={{ ...styles.modalButton, background: c.cardBg, borderColor: c.borderMedium, color: c.textSecondary }} onClick={() => { setRenameTag(null); setRenameValue(''); }}>取消</button>
              <button type="button" style={{ ...styles.modalButton, background: '#31d266', borderColor: '#31d266', color: '#fff' }} onClick={confirmRename}>确认</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div style={{ ...styles.modalOverlay, background: isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(17, 24, 39, 0.35)' }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...styles.modalCard, background: c.cardBg, borderColor: c.border }} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ ...styles.modalTitle, color: c.textPrimary }}>删除标签</h3>
            <p style={{ ...styles.modalBody, color: c.textMuted }}>选择如何处理“{deleteConfirm}”及其子标签。</p>
            <div style={styles.modalStack}>
              <button type="button" style={{ ...styles.modalActionButton, background: c.cardBg, borderColor: c.borderMedium, color: c.textPrimary }} onClick={() => confirmDelete(false)}>仅删除标签（保留笔记）</button>
              <button type="button" style={{ ...styles.modalActionButton, background: '#e53e3e', borderColor: '#e53e3e', color: '#fff' }} onClick={() => confirmDelete(true)}>删除标签和所有相关笔记</button>
              <button type="button" style={{ ...styles.modalActionButton, background: isDark ? '#141414' : '#fff', borderColor: c.borderMedium, color: c.textSecondary }} onClick={() => setDeleteConfirm(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
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
    justifyContent: 'space-between',
  },
  accountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  logoutButton: {
    border: '1px solid',
    borderRadius: 6,
    padding: '2px 8px',
    fontSize: 12,
    cursor: 'pointer',
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
  statButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left',
    color: 'inherit',
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
    flexDirection: 'column',
    gap: 4,
    paddingLeft: 32,
    paddingBottom: 4,
  },
  filterChip: {
    border: 'none',
    borderRadius: 8,
    padding: '8px 12px',
    background: 'transparent',
    color: '#444',
    cursor: 'pointer',
    fontSize: 14,
    textAlign: 'left',
    width: '100%',
  },
  filterChipActive: {
    background: '#31d266',
    color: '#fff',
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
  tagMenuWrap: {
    position: 'relative',
    flexShrink: 0,
  },
  tagMenuButton: {
    width: 30,
    height: 30,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    borderRadius: 6,
  },
  tagMenuDropdown: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: 120,
    border: '1px solid',
    borderRadius: 10,
    padding: 4,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 20,
  },
  tagMenuItem: {
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 120,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    border: '1px solid',
    borderRadius: 16,
    padding: 20,
    boxSizing: 'border-box',
  },
  modalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
  },
  modalBody: {
    margin: '10px 0 14px',
    fontSize: 14,
    lineHeight: 1.5,
  },
  modalInput: {
    width: '100%',
    border: '1px solid',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 14,
    boxSizing: 'border-box',
    outline: 'none',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  modalButton: {
    border: '1px solid',
    borderRadius: 10,
    padding: '9px 16px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  modalStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  modalActionButton: {
    border: '1px solid',
    borderRadius: 10,
    padding: '11px 14px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    textAlign: 'left',
  },
};
