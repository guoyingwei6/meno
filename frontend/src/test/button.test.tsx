import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../components/ui/Button';

describe('Button', () => {
  it('exposes visible focus and hover states without swallowing caller handlers', () => {
    const onFocus = vi.fn();
    const onMouseEnter = vi.fn();
    render(<Button onFocus={onFocus} onMouseEnter={onMouseEnter}>保存</Button>);

    const button = screen.getByRole('button', { name: '保存' });
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(button.style.background).toBe('rgba(17, 17, 17, 0.04)');
    expect(button.style.boxShadow).toContain('0 0 0 3px');
  });

  it('keeps disabled buttons inert', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>保存</Button>);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
