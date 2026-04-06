import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoDetailPage } from '../pages/MemoDetailPage';

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

      if (url.endsWith('/api/dashboard/memos/private-memo-1')) {
        return new Response(
          JSON.stringify({
            memo: {
              id: 3,
              slug: 'private-memo-1',
              content: 'Private memo body',
              excerpt: 'Private memo',
              visibility: 'private',
              displayDate: '2026-03-23',
              createdAt: '2026-03-23T08:00:00.000Z',
              updatedAt: '2026-03-23T08:00:00.000Z',
              publishedAt: null,
              deletedAt: null,
      pinnedAt: null, favoritedAt: null,
              previousVisibility: null,
              hasImages: false,
              imageCount: 0,
              tagCount: 1,
              tags: ['类别/知识储备'],
              assets: [],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ message: 'Memo not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

describe('MemoDetailPage author access', () => {
  it('loads author detail route for private memos when viewer is authenticated', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/private-memo-1']}>
          <Routes>
            <Route path="/memos/:slug" element={<MemoDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Private memo body')).toBeInTheDocument();
  });
});
