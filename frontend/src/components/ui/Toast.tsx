import type { CSSProperties } from 'react';
import { designTokens, useTheme } from '../../lib/theme';

export const Toast = ({ message, style }: { message: string; style?: CSSProperties }) => {
  const { isDark } = useTheme();
  const { colors: c, radius: r, spacing: s, interaction: i } = designTokens(isDark);
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{ ...styles.toast, color: c.accent, background: c.accentLight, borderColor: c.borderLight, borderRadius: r.pill, padding: `2px ${s.sm}px`, transition: i.transition, ...style }}
    >
      {message}
    </span>
  );
};

const styles: Record<string, CSSProperties> = {
  toast: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, border: '1px solid' },
};
