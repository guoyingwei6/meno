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
              { tag: '平台/twitter', count: 1 },
              { tag: '类别/知识储备', count: 3 },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(
          JSON.stringify({
            stats: { total: 0, public: 0, private: 0, trash: 0, tags: 3, streakDays: 0 },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/memos')) {
        return new Response(JSON.stringify({ memos: [] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ memos: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('HomePage tag tree data source', () => {
  it('builds sidebar tag tree from dashboard tags endpoint instead of hardcoded values', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // 侧边栏标签树子项显示为 "# childName" 格式（文本匹配，无 aria-label）
    expect(await screen.findByText('# 小红书')).toBeInTheDocument();
    expect(screen.getByText('# twitter')).toBeInTheDocument();
    expect(screen.getByText('# 知识储备')).toBeInTheDocument();
  });
});
