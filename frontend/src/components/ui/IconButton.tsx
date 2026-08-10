import { useState, type ButtonHTMLAttributes, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { designTokens, useTheme } from '../../lib/theme';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  title?: string;
  active?: boolean;
  children: ReactNode;
}

export const IconButton = ({ label, title, active, disabled, children, style, ...props }: IconButtonProps) => {
  const { isDark } = useTheme();
  const { colors: c, spacing: s, radius: r, interaction: i } = designTokens(isDark);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    setFocused(true);
    props.onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    setFocused(false);
    props.onBlur?.(event);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(true);
    props.onMouseEnter?.(event);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(false);
    props.onMouseLeave?.(event);
  };

  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        ...styles.button,
        padding: s.xs,
        borderRadius: r.sm,
        color: active ? c.accent : c.textTertiary,
        background: active ? i.activeSurface : !disabled && hovered ? i.hoverSurface : 'transparent',
        opacity: disabled ? i.disabledOpacity : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: focused ? i.focusRing : 'none',
        transition: i.transition,
        ...style,
      }}
    >
      {children}
    </button>
  );
};

const styles: Record<string, CSSProperties> = {
  button: {
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 'none',
    appearance: 'none',
  },
};
