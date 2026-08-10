import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { designTokens, useTheme } from '../../lib/theme';
import { Button } from './Button';

interface MenuSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  children: ReactNode;
}

export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(({ label, children, style, ...props }, ref) => {
  const { isDark } = useTheme();
  const { colors: c, radius: r, shadow, spacing: s } = designTokens(isDark);
  return (
    <div
      {...props}
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ ...styles.surface, background: c.cardBg, borderColor: c.borderMedium, borderRadius: r.lg, boxShadow: shadow.subtle, padding: s.xs, ...style }}
    >
      {children}
    </div>
  );
});
MenuSurface.displayName = 'MenuSurface';

interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'default' | 'accent' | 'danger';
  children: ReactNode;
}

export const MenuItem = ({ tone = 'default', children, style, ...props }: MenuItemProps) => {
  const { isDark } = useTheme();
  const { colors: c, radius: r, spacing: s } = designTokens(isDark);
  const color = tone === 'danger' ? c.danger : tone === 'accent' ? c.accent : c.textPrimary;
  return (
    <Button
      {...props}
      variant="ghost"
      size="sm"
      role="menuitem"
      style={{ ...styles.item, color, borderRadius: r.md, padding: `${s.md}px ${s.inputX}px`, ...style }}
    >
      {children}
    </Button>
  );
};

const styles: Record<string, CSSProperties> = {
  surface: { border: '1px solid' },
  item: { display: 'flex', width: '100%', justifyContent: 'flex-start', textAlign: 'left' },
};
