import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/me')) {
        return new Response(
          JSON.stringify({ authenticated: false, role: 'viewer', githubLogin: null }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/public/tags')) {
        return new Response(
          JSON.stringify({ tags: [{ tag: 'serverless', count: 1 }] }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/public/stats')) {
        return new Response(
          JSON.stringify({ stats: { total: 1, tags: 1, streakDays: 1 } }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('HomePage', () => {
  it('renders public memo list from API', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Second public memo')).length).toBeGreaterThan(0);
    expect(screen.getByText('#serverless')).toBeInTheDocument();
  });
});
