import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';

describe('MemoComposer hierarchical tags', () => {
  it('keeps slash-based nested tags in submitted content', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(<MemoComposer defaultDisplayDate="2026-03-25" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), {
      target: { value: '记录一下 #平台/小红书 #类别/知识储备' },
    });
    // 提交按钮是圆形绿色按钮，只含 SVG 图标，取所有 button 中最后一个（toolbar 末尾）
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        content: '记录一下 #平台/小红书 #类别/知识储备',
        visibility: 'public',
        displayDate: '2026-03-25',
      });
    });
  });
});
