import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePage } from '../pages/SharePage';

const renderShare = (token = 'expired-token') => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[`/share/${token}`]}>
      <Routes><Route path="/share/:token" element={<SharePage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);

describe('SharePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'expired' }), { status: 404 })));
  });

  it('shows a clear state when a share token is expired or revoked', async () => {
    renderShare();
    expect(await screen.findByText('分享链接不存在或已失效')).toBeInTheDocument();
  });

  it('uses the safe renderer for shared content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      memo: {
        id: 1,
        slug: 'shared',
        content: '<img src=x onerror="alert(1)">\n\n安全分享',
        excerpt: '安全分享',
        visibility: 'private',
        displayDate: '2026-08-09',
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
        publishedAt: null,
        deletedAt: null,
        pinnedAt: null,
        favoritedAt: null,
        previousVisibility: null,
        hasImages: false,
        imageCount: 0,
        tagCount: 0,
        tags: [],
        assets: [],
      },
    }), { headers: { 'Content-Type': 'application/json' } })));

    const { container } = renderShare('valid-token');
    expect(await screen.findByText('安全分享')).toBeInTheDocument();
    expect(container.querySelector('[onerror], script, iframe')).toBeNull();
  });
});
