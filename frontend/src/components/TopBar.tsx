import { useState } from 'react';
import { loginUrl } from '../lib/runtime-config';
import { useTheme, colors, type ThemeMode } from '../lib/theme';

interface TopBarProps {
  authenticated: boolean;
  githubLogin: string | null;
  onLogout: () => void;
  onToggleSidebar?: () => void;
  onRefresh?: () => Promise<void> | void;
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

export const TopBar = ({ authenticated, githubLogin, onLogout, onToggleSidebar, onRefresh }: TopBarProps) => {
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
        <button type="button" style={styles.iconButton} onClick={onToggleSidebar} aria-label="切换侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <button type="button" style={styles.iconButton} onClick={handleRefresh} aria-label="刷新">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={spinning ? c.accent : c.textTertiary} strokeWidth="2" style={{ transition: 'transform 0.6s ease', transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)' }}>
            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
        <ThemeToggle />
      </div>
      <div style={styles.actions}>
        {authenticated ? (
          <>
            <span style={{ ...styles.identity, color: c.textTertiary }}>@{githubLogin}</span>
            <button type="button" style={{ ...styles.authButtonSecondary, borderColor: c.borderMedium, color: c.textTertiary, background: c.cardBg }} onClick={onLogout}>退出</button>
          </>
        ) : (
          <button type="button" style={styles.authButtonPrimary} onClick={() => window.location.assign(loginUrl())}>GitHub 登录</button>
        )}
      </div>
    </header>
  );
};

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  leftActions: { display: 'flex', alignItems: 'center', gap: 4 },
  iconButton: { border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  actions: { display: 'flex', alignItems: 'center', gap: 10 },
  identity: { fontWeight: 600, fontSize: 14 },
  authButtonPrimary: { border: 'none', borderRadius: 8, padding: '8px 14px', background: '#111', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  authButtonSecondary: { border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 12px', background: '#fff', cursor: 'pointer', fontSize: 13 },
};
