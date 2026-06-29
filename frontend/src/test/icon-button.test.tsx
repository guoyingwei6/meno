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
});
