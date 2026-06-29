import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoCard } from '../components/MemoCard';
import type { MemoSummary } from '../types/shared';

const privateMemo: MemoSummary = {
  id: 3,
  slug: 'private-memo-1',
  content: 'Private memo',
  excerpt: 'Private memo',
  visibility: 'private',
  displayDate: '2026-03-23',
  createdAt: '2026-03-23T08:00:00.000Z',
  updatedAt: '2026-03-23T08:00:00.000Z',
  publishedAt: null,
  deletedAt: null,
  pinnedAt: null,
  favoritedAt: null,
  previousVisibility: null,
  hasImages: false,
  imageCount: 0,
  tagCount: 0,
  tags: [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ share: { url: 'https://meno.test/share/abc123' } }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  ));
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(),
    },
  });
});

describe('MemoCard private share token', () => {
  it('creates a share token before copying a private memo share link', async () => {
    render(<MemoCard memo={privateMemo} isAuthor />);

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '分享' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/dashboard/memos/3/share', expect.objectContaining({ method: 'POST', credentials: 'include' }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://meno.test/share/abc123');
  });
});
