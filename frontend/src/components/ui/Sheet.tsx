import type { CSSProperties, ReactNode } from 'react';
import { Dialog } from './Dialog';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  panelStyle?: CSSProperties;
}

export const Sheet = ({ open, onClose, label, children, panelStyle }: SheetProps) => (
  <Dialog
    open={open}
    onClose={onClose}
    ariaLabel={label}
    overlayStyle={{ display: 'block', padding: 0 }}
    panelStyle={{ position: 'fixed', inset: '0 auto 0 0', borderRadius: 0, ...panelStyle }}
  >
    {children}
  </Dialog>
);
