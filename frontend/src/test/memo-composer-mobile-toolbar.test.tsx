import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';

const originalMatchMedia = window.matchMedia;

const setNarrowScreen = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)),
  });
};

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
  vi.restoreAllMocks();
});

describe('MemoComposer mobile toolbar', () => {
  it('keeps frequent and publish actions visible while hiding direct formatting on narrow screens', () => {
    setNarrowScreen(true);
    render(<MemoComposer defaultDisplayDate="2026-08-10" onSubmit={vi.fn(async () => undefined)} />);

    expect(screen.getByRole('button', { name: '更多' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByTitle('添加标签')).toBeInTheDocument();
    expect(screen.getByTitle('上传图片')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '录音' })).toBeInTheDocument();
    expect(screen.getByTitle('发布')).toBeInTheDocument();
    expect(screen.queryByTitle('加粗')).not.toBeInTheDocument();
    expect(screen.queryByTitle('斜体')).not.toBeInTheDocument();
    expect(screen.queryByTitle('下划线')).not.toBeInTheDocument();
    expect(screen.queryByTitle('代码块')).not.toBeInTheDocument();
    expect(screen.queryByTitle('无序列表')).not.toBeInTheDocument();
    expect(screen.queryByTitle('有序列表')).not.toBeInTheDocument();
  });

  it('opens all formatting actions from the accessible more menu and preserves selection behavior', async () => {
    setNarrowScreen(true);
    render(<MemoComposer defaultDisplayDate="2026-08-10" onSubmit={vi.fn(async () => undefined)} />);

    const textarea = screen.getByPlaceholderText('现在的想法是...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '桌面行为' } });
    textarea.focus();
    textarea.setSelectionRange(0, 4);

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByRole('menu', { name: '更多格式' })).toBeInTheDocument();
    for (const label of ['加粗', '斜体', '下划线', '代码块', '无序列表', '有序列表']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('menuitem', { name: '加粗' }));

    await waitFor(() => {
      expect(textarea).toHaveValue('**桌面行为**');
      expect(textarea).toHaveFocus();
    });
    expect(screen.queryByRole('menu', { name: '更多格式' })).not.toBeInTheDocument();
  });

  it('keeps the direct formatting toolbar on desktop', async () => {
    setNarrowScreen(false);
    render(<MemoComposer defaultDisplayDate="2026-08-10" onSubmit={vi.fn(async () => undefined)} />);

    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
    expect(screen.getByTitle('加粗')).toBeInTheDocument();
    expect(screen.getByTitle('斜体')).toBeInTheDocument();
    expect(screen.getByTitle('下划线')).toBeInTheDocument();
    expect(screen.getByTitle('代码块')).toBeInTheDocument();
    expect(screen.getByTitle('无序列表')).toBeInTheDocument();
    expect(screen.getByTitle('有序列表')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText('现在的想法是...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '桌面行为' } });
    textarea.focus();
    textarea.setSelectionRange(0, 4);
    fireEvent.click(screen.getByTitle('加粗'));

    await waitFor(() => expect(textarea).toHaveValue('**桌面行为**'));
  });
});
