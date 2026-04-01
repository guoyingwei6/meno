import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoDetailPage } from '../pages/MemoDetailPage';
import type { PublicMemoResponse } from '../types/shared';

const mockResponse: PublicMemoResponse = {
  memo: {
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
      pinnedAt: null,
    previousVisibility: null,
    hasImages: false,
    imageCount: 0,
    tagCount: 2,
    tags: ['cloudflare', 'meno'],
    assets: [],
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

describe('MemoDetailPage', () => {
  it('renders a public memo detail by route slug', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/public-memo-1']}>
          <Routes>
            <Route path="/memos/:slug" element={<MemoDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('First public memo')).toBeInTheDocument();
    expect(screen.getByText('#cloudflare')).toBeInTheDocument();
    expect(screen.getByText('#meno')).toBeInTheDocument();
  });
});
