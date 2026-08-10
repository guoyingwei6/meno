import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImportExportModal } from '../components/ImportExportModal';

describe('ImportExportModal', () => {
  it('renders an accessible dialog with shared controls and disabled import state', () => {
    render(<ImportExportModal onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: '导入 / 导出' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: '关闭导入 / 导出' })).toBeInTheDocument();

    const chooseButton = screen.getByRole('button', { name: '① 选择 .md 文件（可多选）' });
    fireEvent.focus(chooseButton);
    expect(chooseButton.style.boxShadow).toContain('0 0 0 3px');
    expect(screen.getByRole('button', { name: '导入 0 篇笔记' })).toBeDisabled();
  });

  it('moves focus into the dialog, wraps Tab, and restores the opener focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<ImportExportModal onClose={vi.fn()} />);
    const closeButton = screen.getByRole('button', { name: '关闭导入 / 导出' });
    const chooseButton = screen.getByRole('button', { name: '① 选择 .md 文件（可多选）' });

    expect(closeButton).toHaveFocus();

    fireEvent.focus(chooseButton);
    fireEvent.keyDown(chooseButton, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.focus(closeButton);
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(chooseButton).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps tab switching and unified close paths working', () => {
    const onClose = vi.fn();
    const { container } = render(<ImportExportModal onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '导出 ZIP' }));
    expect(screen.getByText(/导出所有笔记为 ZIP/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载 ZIP' })).toBeEnabled();

    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
