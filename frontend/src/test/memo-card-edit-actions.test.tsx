import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoCard } from '../components/MemoCard';

const baseMemo = {
  id: 1,
  slug: 'editable-memo',
  content: '可编辑 memo',
  excerpt: '可编辑 memo',
  displayDate: '2026-03-26',
  createdAt: '2026-03-26T08:00:00.000Z',
  updatedAt: '2026-03-26T08:00:00.000Z',
  publishedAt: null,
  deletedAt: null,
      pinnedAt: null, favoritedAt: null,
  previousVisibility: null,
  hasImages: false,
  imageCount: 0,
  tagCount: 0,
  tags: [],
};

describe('MemoCard edit actions', () => {
  it('shows edit and "设为公开" for a private memo', () => {
    const onSaveEdit = vi.fn();
    const onChangeVisibility = vi.fn();
    const memo = { ...baseMemo, visibility: 'private' as const };

    render(
      <MemoCard memo={memo} isAuthor onSaveEdit={onSaveEdit} onChangeVisibility={onChangeVisibility} />,
    );

    // 先打开 ··· 下拉菜单
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    // 点击编辑应进入内联编辑模式而非调用回调
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByText('编辑 Memo')).toBeTruthy();

    // 取消编辑
    fireEvent.click(screen.getByText('取消'));

    // 再次打开菜单
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    fireEvent.click(screen.getByRole('button', { name: '设为公开' }));
    expect(onChangeVisibility).toHaveBeenCalledWith(memo, 'public');
  });

  it('shows "设为私密" for a public memo', () => {
    const onChangeVisibility = vi.fn();
    const memo = { ...baseMemo, visibility: 'public' as const };

    render(
      <MemoCard memo={memo} isAuthor onChangeVisibility={onChangeVisibility} />,
    );

    // 先打开 ··· 下拉菜单
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    fireEvent.click(screen.getByRole('button', { name: '设为私密' }));
    expect(onChangeVisibility).toHaveBeenCalledWith(memo, 'private');
  });

  it('does not show actions for non-author', () => {
    const memo = { ...baseMemo, visibility: 'public' as const };
    render(<MemoCard memo={memo} />);

    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
  });
});
