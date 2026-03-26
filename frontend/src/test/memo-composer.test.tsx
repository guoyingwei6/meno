import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          url: 'https://cdn.example.com/uploads/hello.png',
          objectKey: 'uploads/hello.png',
          fileName: 'hello.png',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
});

describe('MemoComposer', () => {
  it('submits content with selected visibility and display date', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(<MemoComposer defaultDisplayDate="2026-03-25" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), {
      target: { value: '新笔记 #memo' },
    });
    fireEvent.change(screen.getByLabelText('可见性'), {
      target: { value: 'private' },
    });
    fireEvent.change(screen.getByLabelText('归属日期'), {
      target: { value: '2026-03-16' },
    });
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        content: '新笔记 #memo',
        visibility: 'private',
        displayDate: '2026-03-16',
      });
    });
  });

  it('shows image thumbnail after uploading and includes in submitted content', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(<MemoComposer defaultDisplayDate="2026-03-25" onSubmit={onSubmit} />);

    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传图片'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/uploads', expect.objectContaining({ method: 'POST' }));
    });

    // 图片以缩略图预览显示，不在 textarea 中
    await waitFor(() => {
      expect(screen.getByAltText('hello.png')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('现在的想法是...')).toHaveValue('');

    // 提交时图片 markdown 会合并到 content 中
    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), {
      target: { value: '测试图片' },
    });
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        content: '测试图片\n![](https://cdn.example.com/uploads/hello.png)',
        visibility: 'public',
        displayDate: '2026-03-25',
      });
    });
  });
});
