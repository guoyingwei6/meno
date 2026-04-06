import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';

const initialMemos = {
  memos: [
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
      pinnedAt: null, favoritedAt: null,
      previousVisibility: null,
      hasImages: false,
      imageCount: 0,
      tagCount: 2,
      tags: ['cloudflare', 'meno'],
    },
  ],
};

const draftResponse = {
  memo: {
    id: 5,
    slug: 'created-draft',
    content: '新笔记 #newtag',
    excerpt: '新笔记 #newtag',
    visibility: 'draft',
    displayDate: '2026-03-25',
    createdAt: '2026-03-25T10:00:00.000Z',
    updatedAt: '2026-03-25T10:00:00.000Z',
    publishedAt: null,
    deletedAt: null,
      pinnedAt: null, favoritedAt: null,
    previousVisibility: null,
    hasImages: false,
    imageCount: 0,
    tagCount: 1,
    tags: ['newtag'],
  },
};

beforeEach(() => {
  let createCalled = false;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              { tag: 'cloudflare', count: 1 },
              { tag: 'meno', count: 1 },
              { tag: 'newtag', count: createCalled ? 1 : 0 },
            ].filter((item) => item.count > 0),
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(
          JSON.stringify({
            stats: { total: createCalled ? 2 : 1, public: 1, private: 0, draft: createCalled ? 1 : 0, trash: 0, tags: createCalled ? 3 : 2, streakDays: 392 },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/memos')) {
        return new Response(JSON.stringify(createCalled ? { memos: [draftResponse.memo, ...initialMemos.memos] } : initialMemos), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/memos') && init?.method === 'POST') {
        createCalled = true;
        const body = JSON.parse(init?.body as string) as { content: string; visibility: string; displayDate: string };
        expect(body.content).toBe('新笔记 #newtag');
        expect(body.visibility).toBe('public');
        // displayDate 使用当天日期（todayStr），不硬编码具体日期
        return new Response(JSON.stringify(draftResponse), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        });
      }

      if (url.endsWith('/api/auth/logout')) {
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify(initialMemos), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('HomePage create memo flow', () => {
  it('creates a draft memo and refreshes the list', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const textarea = await screen.findByPlaceholderText('现在的想法是...');
    fireEvent.change(textarea, { target: { value: '新笔记 #newtag' } });
    // 提交按钮是圆形绿色按钮，只含 SVG 图标，取 MemoComposer 区域内的最后一个按钮
    const composerSection = textarea.closest('section')!;
    const composerButtons = composerSection.querySelectorAll('button');
    fireEvent.click(composerButtons[composerButtons.length - 1]);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/memos', expect.objectContaining({ method: 'POST' }));
    });

    await waitFor(() => {
      // 标签从正文中去除，只作为 tag pill 显示
      expect(screen.getAllByText('新笔记').length).toBeGreaterThan(0);
      expect(screen.getAllByText('#newtag').length).toBeGreaterThan(0);
    });
  });
});
