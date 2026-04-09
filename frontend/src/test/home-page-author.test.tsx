import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
            tags: [],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(
          JSON.stringify({
            stats: { total: 0, public: 0, private: 0, trash: 0, tags: 0, streakDays: 0 },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          memos: [],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
});

describe('HomePage author mode', () => {
  it('renders the composer for authenticated author', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/me', { credentials: 'include' });
    });

    expect(await screen.findByPlaceholderText('现在的想法是...')).toBeInTheDocument();
  });
});
