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
        return new Response(
          JSON.stringify({ authenticated: true, role: 'author', githubLogin: 'guoyingwei' }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/tags')) {
        return new Response(
          JSON.stringify({
            tags: [
              { tag: '平台/小红书', count: 2 },
              { tag: '类别/知识储备', count: 3 },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(
          JSON.stringify({
            stats: { total: 1, public: 1, private: 0, draft: 0, trash: 0, tags: 2, streakDays: 1152 },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/memos')) {
        return new Response(
          JSON.stringify({
            memos: [
              {
                id: 1,
                slug: 'demo-1',
                content: '女性开启理财第三步（最后一步）\n\n![](https://cdn.example.com/a.png)',
                excerpt: '女性开启理财第三步（最后一步）',
                visibility: 'public',
                displayDate: '2026-02-21',
                createdAt: '2026-02-21T15:33:00.000Z',
                updatedAt: '2026-02-21T15:33:00.000Z',
                publishedAt: '2026-02-21T15:33:00.000Z',
                deletedAt: null,
                previousVisibility: null,
                hasImages: true,
                imageCount: 1,
                tagCount: 2,
                tags: ['平台/小红书', '类别/投资理财'],
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ memos: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('HomePage reference-inspired layout', () => {
  it('renders the sidebar tag section separately and keeps trash visually at bottom', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('全部标签')).toBeInTheDocument();
    // 侧边栏标签树子项显示为 "# childName" 格式（无 aria-label，通过文本匹配）
    expect(screen.getAllByText('# 小红书').length).toBeGreaterThan(0);
    expect(screen.getAllByText('# 知识储备').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '回收站' })).toBeInTheDocument();
    expect(screen.getAllByText('女性开启理财第三步（最后一步）').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'memo preview' })).toBeInTheDocument();
  });
});
