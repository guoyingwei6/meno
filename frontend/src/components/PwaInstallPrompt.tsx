import { useState, type CSSProperties } from 'react';
import { designTokens, useTheme } from '../lib/theme';
import { Button } from './ui/Button';
import { usePwaInstall } from './PwaInstallProvider';

export const PwaInstallPrompt = () => {
  const { isDark } = useTheme();
  const { colors: c, radius: r, shadow } = designTokens(isDark);
  const { isInstallable, isInstalled, isIOS, showIOSPrompt, install, dismissIOSPrompt } = usePwaInstall();
  const [installDismissed, setInstallDismissed] = useState(false);

  if (isInstalled || installDismissed) return null;

  if (isInstallable) {
    return (
      <div
        role="region"
        aria-label="安装 Meno 应用提示"
        style={{
          ...styles.floating,
          background: c.cardBg,
          borderColor: c.borderMedium,
          boxShadow: shadow.panel,
          borderRadius: r.lg,
        }}
      >
        <button
          type="button"
          aria-label="关闭安装提示"
          onClick={() => setInstallDismissed(true)}
          style={{ ...styles.close, color: c.textTertiary }}
        >
          ×
        </button>
        <div style={{ ...styles.icon, background: c.accentLight, color: c.accent, borderRadius: r.md }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <polyline points="8 12 12 16 16 12" />
          </svg>
        </div>
        <div style={styles.copy}>
          <div style={{ ...styles.title, color: c.textPrimary }}>把 Meno 安装成应用</div>
          <p style={{ ...styles.description, color: c.textSecondary }}>从桌面或主屏幕打开，就像原生应用一样独立窗口运行。</p>
        </div>
        <Button variant="primary" size="sm" onClick={install} style={{ flexShrink: 0 }}>安装</Button>
      </div>
    );
  }

  if (isIOS && showIOSPrompt) {
    return (
      <div role="dialog" aria-label="将 Meno 添加到主屏幕" style={styles.iosOverlay}>
        <div
          style={{
            ...styles.iosSheet,
            background: c.cardBg,
            borderColor: c.borderMedium,
            borderRadius: r.lg,
          }}
        >
          <div style={{ ...styles.iosHeader, color: c.textPrimary }}>
            <span style={{ ...styles.iosLogo, background: c.accent, color: '#fff', borderRadius: r.md }}>M</span>
            <span style={styles.title}>将 Meno 添加到主屏幕</span>
          </div>
          <ol style={styles.steps}>
            <li style={{ color: c.textSecondary }}>
              1. 点击 Safari 底部工具栏的「分享」按钮
            </li>
            <li style={{ color: c.textSecondary }}>
              2. 选择「添加到主屏幕」
            </li>
            <li style={{ color: c.textSecondary }}>
              3. 从主屏幕图标打开，即可全屏使用
            </li>
          </ol>
          <Button variant="primary" onClick={dismissIOSPrompt} style={{ width: '100%' }}>我知道了</Button>
        </div>
      </div>
    );
  }

  return null;
};

const styles: Record<string, CSSProperties> = {
  floating: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 80,
    width: 'min(calc(100vw - 32px), 340px)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 12px 12px 14px',
    border: '1px solid',
  },
  close: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 24,
    height: 24,
    display: 'grid',
    placeItems: 'center',
    border: 'none',
    background: 'transparent',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
  },
  icon: {
    width: 34,
    height: 34,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
  },
  copy: { minWidth: 0, flex: 1 },
  title: { fontSize: 13, fontWeight: 600, lineHeight: 1.4 },
  description: { margin: '3px 0 0', fontSize: 12, lineHeight: 1.5 },
  iosOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 90,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: 16,
    background: 'rgba(0,0,0,0.35)',
  },
  iosSheet: {
    width: 'min(100%, 400px)',
    padding: '16px 16px 14px',
    border: '1px solid',
    display: 'grid',
    gap: 12,
  },
  iosHeader: { display: 'flex', alignItems: 'center', gap: 10 },
  iosLogo: {
    width: 30,
    height: 30,
    display: 'grid',
    placeItems: 'center',
    fontSize: 15,
    fontWeight: 700,
    flexShrink: 0,
  },
  steps: {
    margin: 0,
    padding: '0 0 0 18px',
    fontSize: 13,
    lineHeight: 1.9,
  },
};
