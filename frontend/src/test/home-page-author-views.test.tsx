import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';

const authorViews = {
  all: {
    memos: [
      {
        id: 2,
        slug: 'public-memo-2',
        content: 'Second public memo',
        excerpt: 'Second public memo',
        visibility: 'public',
        displayDate: '2026-03-24',
        createdAt: '2026-03-24T12:30:00.000Z',
        updatedAt: '2026-03-24T12:30:00.000Z',
        publishedAt: '2026-03-24T12:30:00.000Z',
        deletedAt: null,
      pinnedAt: null, favoritedAt: null,
        previousVisibility: null,
        hasImages: false,
        imageCount: 0,
        tagCount: 1,
        tags: ['serverless'],
      },
      {
        id: 3,
        slug: 'private-memo-1',
        content: 'Private memo',
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
        tags: ['private-note'],
      },
    ],
  },
  private: {
    memos: [
      {
        id: 3,
        slug: 'private-memo-1',
        content: 'Private memo',
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
        tags: ['private-note'],
      },
    ],
  },
  trash: {
    memos: [
      {
        id: 9,
        slug: 'trashed-memo-1',
        content: 'Trashed memo',
        excerpt: 'Trashed memo',
        visibility: 'public',
        displayDate: '2026-03-20',
        createdAt: '2026-03-20T08:00:00.000Z',
        updatedAt: '2026-03-20T08:00:00.000Z',
        publishedAt: '2026-03-20T08:00:00.000Z',
        deletedAt: '2026-03-24T10:00:00.000Z',
        previousVisibility: 'public',
        hasImages: false,
        imageCount: 0,
        tagCount: 1,
        tags: ['trash'],
      },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/me')) {
        return new Response(
          JSON.stringify({ authenticated: true, role: 'author', githubLogin: 'guoyingwei' }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/tags')) {
        return new Response(
          JSON.stringify({
            tags: [
              { tag: 'serverless', count: 1 },
              { tag: 'private-note', count: 1 },
              { tag: 'trash', count: 1 },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(
          JSON.stringify({
            stats: { total: 2, public: 1, private: 1, draft: 0, trash: 1, tags: 3, streakDays: 10 },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/memos?view=private')) {
        return new Response(JSON.stringify(authorViews.private), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/dashboard/memos?view=trash')) {
        return new Response(JSON.stringify(authorViews.trash), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(authorViews.all), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('HomePage author views', () => {
  it('shows different memo content when switching sidebar views', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Second public memo')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Private memo').length).toBeGreaterThan(0);

    // 展开全部笔记的子菜单（点击图标按钮）
    fireEvent.click(screen.getByText('📋'));

    // 点击筛选chip两次到"私密"
    fireEvent.click(screen.getByRole('button', { name: '公开/私密' }));
    const publicChip = await screen.findByRole('button', { name: '公开' });
    fireEvent.click(publicChip);

    await waitFor(() => {
      expect(screen.queryByText('Second public memo')).not.toBeInTheDocument();
      expect(screen.getAllByText('Private memo').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: '回收站' }));

    await waitFor(() => {
      expect(screen.getAllByText('Trashed memo').length).toBeGreaterThan(0);
      expect(screen.queryByText('Private memo')).not.toBeInTheDocument();
    });
  });
});
