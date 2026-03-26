import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/uploads')) {
        return new Response(
          JSON.stringify({
            url: 'https://cdn.example.com/uploads/hello.png',
            objectKey: 'uploads/hello.png',
            fileName: 'hello.png',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

describe('MemoComposer real upload flow', () => {
  it('uploads the selected file through /api/uploads and shows thumbnail', async () => {
    render(<MemoComposer defaultDisplayDate="2026-03-25" onSubmit={vi.fn(async () => undefined)} />);

    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传图片'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/uploads', expect.objectContaining({ method: 'POST' }));
    });

    // 图片不在 textarea 中，而是以缩略图显示
    expect(screen.getByPlaceholderText('现在的想法是...')).toHaveValue('');
    await waitFor(() => {
      expect(screen.getByAltText('hello.png')).toBeInTheDocument();
    });
  });
});
