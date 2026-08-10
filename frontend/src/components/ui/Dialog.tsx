import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { designTokens, useTheme } from '../../lib/theme';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open?: boolean;
  onClose: () => void;
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
  overlayStyle?: CSSProperties;
  panelStyle?: CSSProperties;
}

export const Dialog = ({ open = true, onClose, ariaLabel, labelledBy, describedBy, children, overlayStyle, panelStyle }: DialogProps) => {
  const { isDark } = useTheme();
  const { colors: c, radius: r, shadow } = designTokens(isDark);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  return (
    <div
      role="presentation"
      style={{ ...styles.overlay, background: c.overlay, ...overlayStyle }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ ...styles.panel, background: c.cardBg, color: c.textPrimary, borderColor: c.borderMedium, borderRadius: r.xl, boxShadow: shadow.panel, ...panelStyle }}
      >
        {children}
      </section>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'grid',
    placeItems: 'center',
    padding: 20,
  },
  panel: {
    border: '1px solid',
    outline: 'none',
  },
};
