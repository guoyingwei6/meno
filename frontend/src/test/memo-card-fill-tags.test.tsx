// frontend/src/test/memo-card-fill-tags.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoCard } from '../components/MemoCard';

const baseMemo = {
  id: 1,
  slug: 'test-memo',
  content: '今天学习了 React 的一些用法',
  excerpt: '今天学习了 React',
  displayDate: '2026-03-31',
  createdAt: '2026-03-31T00:00:00.000Z',
  updatedAt: '2026-03-31T00:00:00.000Z',
  publishedAt: null,
  deletedAt: null,
      pinnedAt: null, favoritedAt: null,
  previousVisibility: null,
  hasImages: false,
  imageCount: 0,
  tagCount: 0,
  tags: [],
  visibility: 'public' as const,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('MemoCard fill-tags menu item', () => {
  it('shows 填充标签（AI）in menu when isAuthor', () => {
    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '填充标签（AI）' })).toBeInTheDocument();
  });

  it('does not show 填充标签（AI）when not author', () => {
    render(<MemoCard memo={baseMemo} allTags={['技术']} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.queryByRole('button', { name: '填充标签（AI）' })).toBeNull();
  });
});

describe('MemoCard fill-tags: no config', () => {
  it('shows toast 请先配置 AI when no config set', async () => {
    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));
    await waitFor(() => {
      expect(screen.getByText('请先配置 AI')).toBeInTheDocument();
    });
  });

  it('shows toast when allTags is empty', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    render(<MemoCard memo={baseMemo} isAuthor allTags={[]} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));
    await waitFor(() => {
      expect(screen.getByText('暂无可用标签，请先创建标签')).toBeInTheDocument();
    });
  });
});

describe('MemoCard fill-tags: loading state', () => {
  it('shows 分析中... and disables button during AI call', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '分析中...' })).toBeDisabled();
    });
  });
});

describe('MemoCard fill-tags: AI call success', () => {
  it('shows confirm modal with suggested tags after AI responds', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["技术", "学习"]' } }],
      }),
    } as Response);

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习', '工作']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('AI 建议添加以下标签')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('#技术')).toBeInTheDocument();
    expect(screen.getByLabelText('#学习')).toBeInTheDocument();
  });

  it('calls onFillTags with tags prepended to content when 应用 clicked', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["技术"]' } }],
      }),
    } as Response);

    const onFillTags = vi.fn();
    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习']} onFillTags={onFillTags} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => screen.getByText('AI 建议添加以下标签'));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    expect(onFillTags).toHaveBeenCalledWith(1, '#技术\n今天学习了 React 的一些用法');
  });

  it('filters out tags already on the memo', async () => {
    const memoWithTag = { ...baseMemo, tags: ['技术'] };
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["技术"]' } }],
      }),
    } as Response);

    render(<MemoCard memo={memoWithTag} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('未找到新的匹配标签')).toBeInTheDocument();
    });
  });

  it('shows toast when AI returns empty array', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '[]' } }],
      }),
    } as Response);

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('未找到新的匹配标签')).toBeInTheDocument();
    });
  });
});

describe('MemoCard fill-tags: AI call failure', () => {
  it('shows error toast when fetch fails', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('AI 调用失败: Network error')).toBeInTheDocument();
    });
  });
});
