import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TagPage } from '../pages/TagPage';
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
      expect(String(input)).toContain('/api/public/memos?tag=serverless');

      return new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('TagPage', () => {
  it('renders memos for the current tag route', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tags/serverless']}>
          <Routes>
            <Route path="/tags/*" element={<TagPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Second public memo')).length).toBeGreaterThan(0);
    expect(screen.getByText('Tag: serverless')).toBeInTheDocument();
  });
});
