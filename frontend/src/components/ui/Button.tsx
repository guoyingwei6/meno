import { useState, type ButtonHTMLAttributes, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { designTokens, useTheme } from '../../lib/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export const Button = ({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled = false,
  children,
  style,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...props
}: ButtonProps) => {
  const { isDark } = useTheme();
  const { colors: c, spacing: s, radius: r, interaction: i } = designTokens(isDark);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    setFocused(true);
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    setFocused(false);
    onBlur?.(event);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(true);
    onMouseEnter?.(event);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(false);
    onMouseLeave?.(event);
  };

  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      border: 'none',
      background: c.accent,
      color: c.textInverse,
    },
    secondary: {
      border: `1px solid ${c.borderMedium}`,
      background: 'transparent',
      color: c.textPrimary,
    },
    ghost: {
      border: 'none',
      background: 'transparent',
      color: c.textSecondary,
    },
  };

  const sizes: Record<ButtonSize, CSSProperties> = {
    sm: { padding: `${s.sm}px ${s.lg}px` },
    md: { padding: `${s.md}px ${s.controlX}px` },
  };

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        ...styles.base,
        ...sizes[size],
        ...variants[variant],
        borderRadius: r.md,
        opacity: disabled ? i.disabledOpacity : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        filter: !disabled && hovered && variant === 'primary' ? 'brightness(0.95)' : undefined,
        ...( !disabled && hovered && variant !== 'primary' ? { background: i.hoverSurface } : {} ),
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
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
    outline: 'none',
    appearance: 'none',
  },
};
