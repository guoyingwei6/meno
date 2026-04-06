import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoEditPage } from '../pages/MemoEditPage';

vi.mock('../lib/caret', async () => {
  const actual = await vi.importActual<typeof import('../lib/caret')>('../lib/caret');
  return {
    ...actual,
    getCaretCoords: () => ({ top: 120, left: 80 }),
  };
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

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
              content: '原始内容',
              excerpt: '原始内容',
              visibility: 'public',
              displayDate: '2026-03-26',
              createdAt: '2026-03-26T08:00:00.000Z',
              updatedAt: '2026-03-26T08:00:00.000Z',
              publishedAt: '2026-03-26T08:00:00.000Z',
              deletedAt: null,
              pinnedAt: null, favoritedAt: null,
              previousVisibility: null,
              hasImages: false,
              imageCount: 0,
              tagCount: 0,
              tags: [],
              assets: [],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/dashboard/tags')) {
        return new Response(
          JSON.stringify({
            tags: [
              { tag: 'apple', count: 1 },
              { tag: 'banana', count: 1 },
              { tag: 'cherry', count: 1 },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('MemoEditPage tag navigation', () => {
  it('keeps the keyboard-highlighted tag when dropdown position recalculates', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/editable-memo/edit']}>
          <Routes>
            <Route path="/memos/:slug/edit" element={<MemoEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const textarea = await screen.findByDisplayValue('原始内容');

    fireEvent.change(textarea, { target: { value: '#' } });
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: '#cherry' })).toHaveStyle({ background: 'rgb(240, 240, 240)' });

    fireEvent.keyUp(textarea, { key: 'a', target: textarea });

    expect(screen.getByRole('button', { name: '#cherry' })).toHaveStyle({ background: 'rgb(240, 240, 240)' });
    expect(screen.getByRole('button', { name: '#apple' })).toHaveStyle({ background: 'transparent' });
  });

  it('dismisses the tag dropdown on Escape and keeps it dismissed until the tag text changes', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/editable-memo/edit']}>
          <Routes>
            <Route path="/memos/:slug/edit" element={<MemoEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const textarea = await screen.findByDisplayValue('原始内容');

    fireEvent.change(textarea, { target: { value: '#' } });
    expect(screen.getByRole('button', { name: '#apple' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyUp(window, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: '#apple' })).not.toBeInTheDocument();
    await waitFor(() => expect(textarea).toHaveFocus());

    fireEvent.keyUp(textarea, { key: 'a', target: textarea });
    expect(screen.queryByRole('button', { name: '#apple' })).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '#a' } });
    expect(screen.getByRole('button', { name: '#apple' })).toBeInTheDocument();
  });

  it('closes the tag dropdown when the textarea loses focus', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/editable-memo/edit']}>
          <Routes>
            <Route path="/memos/:slug/edit" element={<MemoEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const textarea = await screen.findByDisplayValue('原始内容');
    fireEvent.change(textarea, { target: { value: '#' } });
    expect(screen.getByRole('button', { name: '#apple' })).toBeInTheDocument();

    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '#apple' })).not.toBeInTheDocument();
    });
  });
});
