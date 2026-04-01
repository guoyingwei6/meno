import { render, screen } from '@testing-library/react';
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
      pinnedAt: null,
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
    expect(images[0]).toHaveAttribute('src', 'https://cdn.example.com/uploads/a.png');
    expect(images[1]).toHaveAttribute('src', 'https://cdn.example.com/uploads/b.png');
  });
});
