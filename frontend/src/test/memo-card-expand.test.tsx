import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoCard } from '../components/MemoCard';

describe('MemoCard expand', () => {
  it('clips collapsed long content at a complete text line', () => {
    const longText = '这是一段很长的内容。'.repeat(21);

    render(
      <MemoCard
        memo={{
          id: 1,
          slug: 'long-card',
          content: longText,
          excerpt: '长内容卡片',
          visibility: 'public',
          displayDate: '2026-03-25',
          createdAt: '2026-03-25T09:00:00.000Z',
          updatedAt: '2026-03-25T09:00:00.000Z',
          publishedAt: '2026-03-25T09:00:00.000Z',
          deletedAt: null,
          pinnedAt: null,
          favoritedAt: null,
          previousVisibility: null,
          hasImages: false,
          imageCount: 0,
          tagCount: 1,
          tags: ['类别/知识储备'],
        }}
      />,
    );

    const contentBlock = screen.getByText(longText).parentElement;

    expect(contentBlock).toHaveStyle({ maxHeight: '150.8px', overflow: 'hidden' });
  });

  it('shows an expand action for long content and reveals full text after click', () => {
    const longText = '这是一段很长的内容。'.repeat(21);

    render(
      <MemoCard
        memo={{
          id: 1,
          slug: 'long-card',
          content: longText,
          excerpt: '长内容卡片',
          visibility: 'public',
          displayDate: '2026-03-25',
          createdAt: '2026-03-25T09:00:00.000Z',
          updatedAt: '2026-03-25T09:00:00.000Z',
          publishedAt: '2026-03-25T09:00:00.000Z',
          deletedAt: null,
          pinnedAt: null,
          favoritedAt: null,
          previousVisibility: null,
          hasImages: false,
          imageCount: 0,
          tagCount: 1,
          tags: ['类别/知识储备'],
        }}
      />,
    );

    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByText(longText)).toBeInTheDocument();
  });
});
