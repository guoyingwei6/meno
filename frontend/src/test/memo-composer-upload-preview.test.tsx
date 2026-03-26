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
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
});

describe('MemoComposer upload preview', () => {
  it('shows uploaded image as a thumbnail preview with delete button', async () => {
    render(<MemoComposer defaultDisplayDate="2026-03-25" onSubmit={vi.fn(async () => undefined)} />);

    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传图片'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByAltText('hello.png')).toBeInTheDocument();
    });

    // 有删除按钮
    expect(screen.getByLabelText('删除 hello.png')).toBeInTheDocument();
  });

  it('removes image when delete button is clicked', async () => {
    render(<MemoComposer defaultDisplayDate="2026-03-25" onSubmit={vi.fn(async () => undefined)} />);

    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传图片'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByAltText('hello.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('删除 hello.png'));
    expect(screen.queryByAltText('hello.png')).not.toBeInTheDocument();
  });
});
