import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarShell } from '../components/SidebarShell';

const tagTree = {
  groups: [{ label: '平台', children: [{ name: '剪藏', count: 2 }], count: 2 }],
  flat: [],
};

const renderAuthenticatedSidebar = (props: Partial<React.ComponentProps<typeof SidebarShell>> = {}) => render(
  <SidebarShell
    memoCount={10}
    tagCount={1}
    authenticated
    tagTree={tagTree}
    {...props}
  />,
);

describe('SidebarShell tag menu and confirmation accessibility', () => {
  it('exposes the tag actions as a menu with keyboard navigation and focus return', () => {
    renderAuthenticatedSidebar();

    const trigger = screen.getByRole('button', { name: '管理标签 平台' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    const menu = screen.getByRole('menu', { name: '平台 标签操作' });
    const renameItem = screen.getByRole('menuitem', { name: '重命名' });
    const deleteItem = screen.getByRole('menuitem', { name: '删除标签' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(renameItem).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(deleteItem).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(renameItem).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '平台 标签操作' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: '平台 标签操作' })).not.toBeInTheDocument();
  });

  it('keeps rename behavior while exposing a dialog and closing it from Escape or the overlay', () => {
    const onRenameTag = vi.fn();
    renderAuthenticatedSidebar({ onRenameTag });

    const trigger = screen.getByRole('button', { name: '管理标签 平台' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));

    const dialog = screen.getByRole('dialog', { name: '重命名标签' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = screen.getByRole('textbox', { name: '新标签名称' });
    fireEvent.change(input, { target: { value: '新平台' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTag).toHaveBeenCalledWith('平台', '新平台');
    expect(screen.queryByRole('dialog', { name: '重命名标签' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '重命名标签' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    const reopenedDialog = screen.getByRole('dialog', { name: '重命名标签' });
    fireEvent.click(reopenedDialog);
    expect(screen.getByRole('dialog', { name: '重命名标签' })).toBeInTheDocument();
    fireEvent.click(reopenedDialog.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog', { name: '重命名标签' })).not.toBeInTheDocument();
  });

  it('keeps both delete choices and exposes the delete confirmation as a dialog', () => {
    const onDeleteTag = vi.fn();
    renderAuthenticatedSidebar({ onDeleteTag });

    const trigger = screen.getByRole('button', { name: '管理标签 平台' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除标签' }));

    const dialog = screen.getByRole('dialog', { name: '删除标签' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const preserveNotesButton = screen.getByRole('button', { name: '仅删除标签（保留笔记）' });
    expect(preserveNotesButton).toHaveFocus();
    fireEvent.click(preserveNotesButton);
    expect(onDeleteTag).toHaveBeenCalledWith('平台', false);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除标签' }));
    fireEvent.click(screen.getByRole('button', { name: '删除标签和所有相关笔记' }));
    expect(onDeleteTag).toHaveBeenCalledWith('平台', true);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除标签' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '删除标签' })).not.toBeInTheDocument();
  });
});
