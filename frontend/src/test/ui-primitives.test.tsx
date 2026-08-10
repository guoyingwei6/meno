import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../components/ui/Dialog';
import { MenuItem, MenuSurface } from '../components/ui/Menu';
import { Sheet } from '../components/ui/Sheet';
import { Toast } from '../components/ui/Toast';

describe('UI primitives', () => {
  it('closes dialogs with Escape or the backdrop and restores focus', () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender, unmount } = render(
      <Dialog onClose={onClose} ariaLabel="设置">
        <button>保存</button>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: '设置' });
    expect(screen.getByRole('button', { name: '保存' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(
      <Dialog open={false} onClose={onClose} ariaLabel="设置">
        <button>保存</button>
      </Dialog>,
    );
    expect(trigger).toHaveFocus();
    unmount();
    trigger.remove();
  });

  it('gives sheets dialog semantics and closes them with Escape', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} label="移动导航">内容</Sheet>);

    const sheet = screen.getByRole('dialog', { name: '移动导航' });
    fireEvent.keyDown(sheet, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes menu, menuitem, and live status semantics', () => {
    render(
      <>
        <MenuSurface label="笔记操作">
          <MenuItem>编辑</MenuItem>
        </MenuSurface>
        <Toast message="已保存" />
      </>,
    );

    expect(screen.getByRole('menu', { name: '笔记操作' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '编辑' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
  });
});
