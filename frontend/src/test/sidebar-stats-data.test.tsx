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

      if (url.includes('/api/dashboard/stats')) {
        return new Response(
          JSON.stringify({
            stats: {
              total: 650,
              public: 320,
              private: 200,
              draft: 130,
              trash: 7,
              tags: 34,
              streakDays: 1152,
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/tags')) {
        return new Response(JSON.stringify({ tags: [] }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/api/dashboard/memos')) {
        return new Response(JSON.stringify({ memos: [] }), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ memos: [] }), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

describe('Sidebar real stats', () => {
  it('renders memo count, tag count and streak days from dashboard stats', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('650')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('1152')).toBeInTheDocument();
  });
});
