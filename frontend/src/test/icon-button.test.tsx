import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '../components/ui/IconButton';

describe('IconButton', () => {
  it('uses the label for accessible button text and click behavior', () => {
    const onClick = vi.fn();
    render(<IconButton label="刷新" onClick={onClick}>↻</IconButton>);

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps disabled buttons inert', () => {
    const onClick = vi.fn();
    render(<IconButton label="导入/导出" disabled onClick={onClick}>⇩</IconButton>);

    fireEvent.click(screen.getByRole('button', { name: '导入/导出' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders tokenized hover and focus states while forwarding handlers', () => {
    const onFocus = vi.fn();
    const onMouseEnter = vi.fn();
    render(<IconButton label="设置" onFocus={onFocus} onMouseEnter={onMouseEnter}>⚙</IconButton>);

    const button = screen.getByRole('button', { name: '设置' });
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(button.style.background).toBe('rgba(17, 17, 17, 0.04)');
    expect(button.style.boxShadow).toContain('0 0 0 3px');
  });
});
