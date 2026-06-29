import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTheme, colors } from '../../lib/theme';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  title?: string;
  active?: boolean;
  children: ReactNode;
}

export const IconButton = ({ label, title, active, disabled, children, style, ...props }: IconButtonProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);

  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      style={{
        ...styles.button,
        color: active ? c.accent : c.textTertiary,
        background: active ? (isDark ? 'rgba(58,168,100,0.16)' : 'rgba(58,168,100,0.1)') : 'transparent',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
};

const styles: Record<string, React.CSSProperties> = {
  button: {
    border: 'none',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    transition: 'background 0.15s ease, color 0.15s ease, opacity 0.15s ease',
  },
};
