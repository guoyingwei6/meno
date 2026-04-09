import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/me')) {
        return new Response(JSON.stringify({ authenticated: true, role: 'author', githubLogin: 'guoyingwei' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/dashboard/tags')) {
        return new Response(JSON.stringify({ tags: [] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(JSON.stringify({ stats: { total: 1, public: 1, private: 0, trash: 0, tags: 0, streakDays: 1 } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          memos: [
            {
              id: 1,
              slug: 'demo-1',
              content: '一条 memo',
              excerpt: '一条 memo',
              visibility: 'public',
              displayDate: '2026-03-25',
              createdAt: '2026-03-25T08:00:00.000Z',
              updatedAt: '2026-03-25T08:00:00.000Z',
              publishedAt: '2026-03-25T08:00:00.000Z',
              deletedAt: null,
      pinnedAt: null, favoritedAt: null,
              previousVisibility: null,
              hasImages: false,
              imageCount: 0,
              tagCount: 0,
              tags: [],
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
});

describe('HomePage timeline header', () => {
  it('renders note count title above the timeline', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('笔记（1）')).toBeInTheDocument();
  });
});
