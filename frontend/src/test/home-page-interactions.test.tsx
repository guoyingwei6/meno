import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';
import type { PublicMemosResponse } from '../types/shared';

const mockResponse: PublicMemosResponse = {
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
      previousVisibility: null,
      hasImages: false,
      imageCount: 0,
      tagCount: 1,
      tags: ['serverless'],
    },
    {
      id: 1,
      slug: 'public-memo-1',
      content: 'First public memo',
      excerpt: 'First public memo',
      visibility: 'public',
      displayDate: '2026-03-24',
      createdAt: '2026-03-24T09:00:00.000Z',
      updatedAt: '2026-03-24T09:00:00.000Z',
      publishedAt: '2026-03-24T09:00:00.000Z',
      deletedAt: null,
      previousVisibility: null,
      hasImages: false,
      imageCount: 0,
      tagCount: 2,
      tags: ['cloudflare', 'meno'],
    },
  ],
};

const assignMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/me')) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            role: 'author',
            githubLogin: 'guoyingwei',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/tags')) {
        return new Response(
          JSON.stringify({
            tags: [
              { tag: 'serverless', count: 1 },
              { tag: 'cloudflare', count: 1 },
              { tag: 'meno', count: 1 },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(
          JSON.stringify({
            stats: { total: 2, public: 2, private: 0, draft: 0, trash: 0, tags: 3, streakDays: 5 },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/memos?view=all&date=2026-03-16')) {
        return new Response(
          JSON.stringify({
            memos: [
              {
                id: 16,
                slug: 'filtered-memo',
                content: 'Filtered memo',
                excerpt: 'Filtered memo',
                visibility: 'public',
                displayDate: '2026-03-16',
                createdAt: '2026-03-16T08:00:00.000Z',
                updatedAt: '2026-03-16T08:00:00.000Z',
                publishedAt: '2026-03-16T08:00:00.000Z',
                deletedAt: null,
                previousVisibility: null,
                hasImages: false,
                imageCount: 0,
                tagCount: 1,
                tags: ['filtered'],
              },
            ],
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url.includes('/api/dashboard/memos')) {
        return new Response(JSON.stringify(mockResponse), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );

  Object.defineProperty(window, 'location', {
    value: { assign: assignMock },
    writable: true,
  });
});

describe('HomePage interactions', () => {
  it('navigates to memo detail when a memo card is clicked', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // 等待 memo 内容渲染（通过等待 tag pill 出现来确认 memo 已加载）
    await screen.findByRole('button', { name: '#serverless' }, { timeout: 3000 });
    // MemoCard 结构：div[role="button"][aria-label=excerpt] > article
    // 通过 article 元素找到父级可点击卡片并点击
    const articles = document.querySelectorAll<HTMLElement>('article');
    // 找到包含 "Second public memo" 文字的 article 并点击其父元素（即 div[role="button"]）
    const targetArticle = Array.from(articles).find((a) => a.textContent?.includes('Second public memo'));
    fireEvent.click(targetArticle!.parentElement!);
  });

  it('navigates to tag page when a tag pill is clicked', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const tagPill = await screen.findByRole('button', { name: '#serverless' });
    fireEvent.click(tagPill);

    expect(assignMock).toHaveBeenCalledWith('/tags/serverless');
  });

  it('filters memos when a sidebar view is selected', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // 先展开全部笔记子菜单（点击图标按钮）
    await screen.findByText('全部笔记');
    fireEvent.click(screen.getByText('📋'));

    // 点击筛选chip：第一次=公开，第二次=私密
    const filterChip = screen.getByRole('button', { name: '公开/私密' });
    fireEvent.click(filterChip); // -> 公开

    const publicChip = await screen.findByRole('button', { name: '公开' });
    fireEvent.click(publicChip); // -> 私密

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/dashboard/memos?view=private', { credentials: 'include' });
    });
  });

  it('filters memos when a calendar day is selected', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const dayButton = await screen.findByRole('button', { name: '16日' });
    fireEvent.click(dayButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith('/api/dashboard/memos?view=all&date=2026-03-16', { credentials: 'include' });
    });
  });
});
