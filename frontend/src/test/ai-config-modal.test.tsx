import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiConfigModal } from '../components/AiConfigModal';

beforeEach(() => {
  localStorage.clear();
});

describe('AiConfigModal', () => {
  it('renders an accessible dialog with the shared close and action buttons', () => {
    render(<AiConfigModal onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'AI 配置' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: '关闭 AI 配置' })).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: '保存' });
    fireEvent.mouseEnter(saveButton);
    fireEvent.focus(saveButton);
    expect(saveButton.style.filter).toBe('brightness(0.95)');
    expect(saveButton.style.boxShadow).toContain('0 0 0 3px');
  });

  it('moves focus into the dialog, wraps Tab, and restores the opener focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<AiConfigModal onClose={vi.fn()} />);
    const closeButton = screen.getByRole('button', { name: '关闭 AI 配置' });
    const saveButton = screen.getByRole('button', { name: '保存' });

    expect(closeButton).toHaveFocus();

    fireEvent.focus(saveButton);
    fireEvent.keyDown(saveButton, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.focus(closeButton);
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(saveButton).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('closes from the overlay and Escape key', () => {
    const onClose = vi.fn();
    const { container } = render(<AiConfigModal onClose={onClose} />);

    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders empty fields when no config saved', () => {
    render(<AiConfigModal onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('https://api.openai.com/v1')).toHaveValue('');
    expect(screen.getByPlaceholderText('gpt-4o-mini')).toHaveValue('');
  });

  it('pre-fills fields from saved config', () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    }));
    render(<AiConfigModal onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('https://api.openai.com/v1')).toHaveValue('https://api.example.com/v1');
    expect(screen.getByPlaceholderText('gpt-4o-mini')).toHaveValue('gpt-4o');
  });

  it('saves config and calls onClose when 保存 clicked', () => {
    const onClose = vi.fn();
    render(<AiConfigModal onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-testkey' },
    });
    fireEvent.change(screen.getByPlaceholderText('gpt-4o-mini'), {
      target: { value: 'gpt-4o-mini' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onClose).toHaveBeenCalled();
    const saved = JSON.parse(localStorage.getItem('meno_ai_config') ?? '{}');
    expect(saved.url).toBe('https://api.openai.com/v1');
    expect(saved.apiKey).toBe('sk-testkey');
    expect(saved.model).toBe('gpt-4o-mini');
  });

  it('calls onClose when 取消 clicked', () => {
    const onClose = vi.fn();
    render(<AiConfigModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });
});
