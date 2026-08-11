import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoCard } from '../components/MemoCard';

describe('MemoCard image previews', () => {
  it('renders thumbnail previews when markdown contains image URLs', () => {
    render(
      <MemoCard
        memo={{
          id: 1,
          slug: 'image-card',
          content: '封面图\n\n![](https://cdn.example.com/uploads/a.png)\n![](https://cdn.example.com/uploads/b.png)',
          excerpt: '封面图',
          visibility: 'public',
          displayDate: '2026-03-25',
          createdAt: '2026-03-25T09:00:00.000Z',
          updatedAt: '2026-03-25T09:00:00.000Z',
          publishedAt: '2026-03-25T09:00:00.000Z',
          deletedAt: null,
      pinnedAt: null, favoritedAt: null,
          previousVisibility: null,
          hasImages: true,
          imageCount: 2,
          tagCount: 1,
          tags: ['平台/小红书'],
        }}
      />,
    );

    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('src', 'https://cdn.example.com/cdn-cgi/image/width=64,quality=75,format=auto/https://cdn.example.com/uploads/a.png');
    expect(images[1]).toHaveAttribute('src', 'https://cdn.example.com/cdn-cgi/image/width=64,quality=75,format=auto/https://cdn.example.com/uploads/b.png');
  });

  it('keeps private asset previews on the authenticated asset URL', () => {
    render(
      <MemoCard
        memo={{
          id: 2,
          slug: 'private-image-card',
          content: '![](https://api.example.com/api/assets/uploads/private.png)',
          excerpt: 'private image',
          visibility: 'private',
          displayDate: '2026-03-25',
          createdAt: '2026-03-25T09:00:00.000Z',
          updatedAt: '2026-03-25T09:00:00.000Z',
          publishedAt: '2026-03-25T09:00:00.000Z',
          deletedAt: null,
          pinnedAt: null,
          favoritedAt: null,
          previousVisibility: null,
          hasImages: true,
          imageCount: 1,
          tagCount: 0,
          tags: [],
        }}
      />,
    );

    expect(screen.getByRole('img', { name: 'memo preview' })).toHaveAttribute(
      'src',
      'https://api.example.com/api/assets/uploads/private.png',
    );
  });

  it('renders the image lightbox at the document root instead of inside the memo card', () => {
    render(
      <MemoCard
        memo={{
          id: 3,
          slug: 'fullscreen-image-card',
          content: '![](https://cdn.example.com/uploads/fullscreen.png)',
          excerpt: 'fullscreen image',
          visibility: 'public',
          displayDate: '2026-03-25',
          createdAt: '2026-03-25T09:00:00.000Z',
          updatedAt: '2026-03-25T09:00:00.000Z',
          publishedAt: '2026-03-25T09:00:00.000Z',
          deletedAt: null,
          pinnedAt: null,
          favoritedAt: null,
          previousVisibility: null,
          hasImages: true,
          imageCount: 1,
          tagCount: 0,
          tags: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('img', { name: 'memo preview' }));

    expect(screen.getByRole('img', { name: 'full size' }).closest('article')).toBeNull();
  });
});
