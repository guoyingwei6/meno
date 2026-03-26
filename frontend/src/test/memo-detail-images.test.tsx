import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoDetailPage } from '../pages/MemoDetailPage';
import type { PublicMemoResponse } from '../types/shared';

const mockResponse: PublicMemoResponse = {
  memo: {
    id: 10,
    slug: 'image-memo',
    content: '图文 memo\n\n![](https://cdn.example.com/uploads/a.png)',
    excerpt: '图文 memo',
    visibility: 'public',
    displayDate: '2026-03-25',
    createdAt: '2026-03-25T09:00:00.000Z',
    updatedAt: '2026-03-25T09:00:00.000Z',
    publishedAt: '2026-03-25T09:00:00.000Z',
    deletedAt: null,
    previousVisibility: null,
    hasImages: true,
    imageCount: 1,
    tagCount: 1,
    tags: ['平台/小红书'],
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

describe('MemoDetailPage images', () => {
  it('renders markdown image content in the memo detail view', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/image-memo']}>
          <Routes>
            <Route path="/memos/:slug" element={<MemoDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const image = await screen.findByRole('img');
    expect(image).toHaveAttribute('src', 'https://cdn.example.com/uploads/a.png');
    expect(screen.getByText('#平台/小红书')).toBeInTheDocument();
  });
});
