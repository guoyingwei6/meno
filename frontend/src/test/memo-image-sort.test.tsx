import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';
import { SortableImagePreviewList, reorderSortableItems } from '../components/SortableImagePreviewList';
import { MemoEditPage } from '../pages/MemoEditPage';

describe('reorderSortableItems', () => {
  it('moves an item to a new position', () => {
    expect(reorderSortableItems(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('keeps the list unchanged when source and target are the same', () => {
    expect(reorderSortableItems(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('SortableImagePreviewList fallback controls', () => {
  it('reorders items with the move buttons', () => {
    const onReorder = vi.fn();

    render(
      <SortableImagePreviewList
        items={[
          { id: 'a', url: 'https://cdn.example.com/a.png', name: 'a.png' },
          { id: 'b', url: 'https://cdn.example.com/b.png', name: 'b.png' },
        ]}
        onReorder={onReorder}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText('右移 a.png'));

    expect(onReorder).toHaveBeenCalledWith([
      { id: 'b', url: 'https://cdn.example.com/b.png', name: 'b.png' },
      { id: 'a', url: 'https://cdn.example.com/a.png', name: 'a.png' },
    ]);
  });
});

describe('memo image order persistence', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (url.endsWith('/api/uploads')) {
          const formData = init?.body as FormData;
          const file = formData.get('file') as File;
          return new Response(
            JSON.stringify({
              url: `https://cdn.example.com/uploads/${file.name}`,
              objectKey: `uploads/${file.name}`,
              fileName: file.name,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (url.endsWith('/api/me')) {
          return new Response(JSON.stringify({ authenticated: true, role: 'author', githubLogin: 'guoyingwei6' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.endsWith('/api/dashboard/memos/editable-memo')) {
          return new Response(
            JSON.stringify({
              memo: {
                id: 1,
                slug: 'editable-memo',
                content: '原始内容\n![](https://cdn.example.com/uploads/a.png)\n![](https://cdn.example.com/uploads/b.png)',
                excerpt: '原始内容',
                visibility: 'public',
                displayDate: '2026-03-26',
                createdAt: '2026-03-26T08:00:00.000Z',
                updatedAt: '2026-03-26T08:00:00.000Z',
                publishedAt: '2026-03-26T08:00:00.000Z',
                deletedAt: null,
                pinnedAt: null,
                favoritedAt: null,
                previousVisibility: null,
                hasImages: true,
                imageCount: 2,
                tagCount: 0,
                tags: [],
                assets: [],
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (url.endsWith('/api/dashboard/tags')) {
          return new Response(JSON.stringify({ tags: [] }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.endsWith('/api/memos/1') && init?.method === 'PATCH') {
          return new Response(
            JSON.stringify({
              memo: {
                id: 1,
                slug: 'editable-memo',
                content: 'ok',
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  });

  it('submits composer images in the reordered sequence', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(<MemoComposer defaultDisplayDate="2026-03-25" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('上传图片'), {
      target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] },
    });
    fireEvent.change(screen.getByLabelText('上传图片'), {
      target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('右移 a.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('右移 a.png'));
    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), {
      target: { value: '正文' },
    });
    fireEvent.click(screen.getByTitle('发布'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        content: '正文\n![](https://cdn.example.com/uploads/b.png)\n![](https://cdn.example.com/uploads/a.png)',
      }));
    });
  });

  it('saves editor images in the reordered sequence', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/editable-memo/edit']}>
          <Routes>
            <Route path="/memos/:slug/edit" element={<MemoEditPage />} />
            <Route path="/memos/:slug" element={<div>detail</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('右移 a.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('右移 a.png'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/memos/1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          content: '原始内容\n![](https://cdn.example.com/uploads/b.png)\n![](https://cdn.example.com/uploads/a.png)',
          visibility: 'public',
          displayDate: '2026-03-26',
        }),
      }));
    });
  });
});
