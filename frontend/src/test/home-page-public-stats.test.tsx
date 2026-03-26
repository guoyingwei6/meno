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
        return new Response(JSON.stringify({ authenticated: false, role: 'viewer', githubLogin: null }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/public/stats')) {
        return new Response(
          JSON.stringify({ stats: { total: 650, tags: 34, streakDays: 1152 } }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/public/tags')) {
        return new Response(JSON.stringify({ tags: [] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ memos: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('HomePage public stats', () => {
  it('uses public stats endpoint for visitor sidebar metrics', async () => {
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
