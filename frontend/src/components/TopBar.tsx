import { useState } from 'react';
import { useTheme, colors, type ThemeMode } from '../lib/theme';

interface TopBarProps {
  authenticated: boolean;
  githubLogin: string | null;
  onLogout: () => void;
  onToggleSidebar?: () => void;
  onRefresh?: () => Promise<void> | void;
  onImportExport?: () => void;
  onAiConfig?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

const ThemeToggle = () => {
  const { mode, setMode } = useTheme();
  const next: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'auto', auto: 'light' };
  const icons: Record<ThemeMode, string> = { light: '☀️', dark: '🌙', auto: '🖥' };
  return (
    <button type="button" style={styles.iconButton} onClick={() => setMode(next[mode])} aria-label={`主题: ${mode}`} title={`当前: ${mode === 'auto' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}`}>
      <span style={{ fontSize: 16 }}>{icons[mode]}</span>
    </button>
  );
};

export const TopBar = ({ authenticated, githubLogin, onLogout, onToggleSidebar, onRefresh, onImportExport, onAiConfig, searchQuery = '', onSearchChange }: TopBarProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [spinning, setSpinning] = useState(false);

  const handleRefresh = async () => {
    setSpinning(true);
    try {
      await onRefresh?.();
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  };

  return (
    <header style={styles.header}>
      <div style={styles.leftActions}>
        <button type="button" style={styles.iconButton} onClick={onToggleSidebar} aria-label="切换侧边栏" title="折叠 / 展开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <button type="button" style={styles.iconButton} onClick={handleRefresh} aria-label="刷新" title="刷新">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={spinning ? c.accent : c.textTertiary} strokeWidth="2" style={{ transition: 'transform 0.6s ease', transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)' }}>
            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
        <ThemeToggle />
        {authenticated && (
          <button type="button" style={styles.iconButton} onClick={onImportExport} aria-label="导入/导出" title="导入 / 导出">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        )}
        {authenticated && (
          <button type="button" style={styles.iconButton} onClick={onAiConfig} aria-label="AI 配置" title="AI 配置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth="2">
              <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
              <path d="m14 7 3 3" />
              <path d="M5 6v4" /><path d="M19 14v4" />
              <path d="M10 2v2" /><path d="M7 8H3" />
              <path d="M21 16h-4" /><path d="M11 3H9" />
            </svg>
          </button>
        )}
      </div>
      <div style={styles.actions}>
        <div style={{ ...styles.searchWrap, background: c.inputBg, borderColor: c.border }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.textMuted} strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="搜索笔记..."
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            style={{ ...styles.searchInput, color: c.textPrimary }}
          />
          {searchQuery && (
            <button type="button" style={styles.searchClear} onClick={() => onSearchChange?.('')} aria-label="清除搜索">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c.textMuted} strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  leftActions: { display: 'flex', alignItems: 'center', gap: 4 },
  iconButton: { border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  actions: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'flex-end' },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 6, border: '1px solid', borderRadius: 8, padding: '5px 10px', maxWidth: 240, flex: 1 },
  searchInput: { border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: '100%', lineHeight: 1.4 },
  searchClear: { border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' },
  identity: { fontWeight: 600, fontSize: 14 },
  authButtonSecondary: { border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 12px', background: '#fff', cursor: 'pointer', fontSize: 13 },
};
