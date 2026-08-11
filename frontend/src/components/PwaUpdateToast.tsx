import { useEffect, useState, type CSSProperties } from 'react';
import { designTokens, useTheme } from '../lib/theme';
import { Button } from './ui/Button';
import { PWA_UPDATE_EVENT, reloadForUpdate } from '../lib/pwa-register';

export const PwaUpdateToast = () => {
  const { isDark } = useTheme();
  const { colors: c, radius: r, shadow } = designTokens(isDark);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handle = () => setVisible(true);
    window.addEventListener(PWA_UPDATE_EVENT, handle);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, handle);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...styles.toast,
        background: c.cardBg,
        borderColor: c.borderMedium,
        boxShadow: shadow.panel,
        borderRadius: r.md,
        color: c.textPrimary,
      }}
    >
      <span style={styles.text}>发现新版本，刷新后生效</span>
      <Button size="sm" variant="primary" onClick={reloadForUpdate}>刷新</Button>
      <button
        type="button"
        aria-label="关闭新版本提示"
        onClick={() => setVisible(false)}
        style={{ ...styles.close, color: c.textTertiary }}
      >
        ×
      </button>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  toast: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 80,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 10px 10px 14px',
    border: '1px solid',
    maxWidth: 'min(calc(100vw - 32px), 380px)',
  },
  text: { fontSize: 13, minWidth: 0, flex: 1 },
  close: {
    width: 24,
    height: 24,
    display: 'grid',
    placeItems: 'center',
    border: 'none',
    background: 'transparent',
    fontSize: 17,
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
  },
};
