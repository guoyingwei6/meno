import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../components/TopBar';

beforeEach(() => {
  (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ = 'https://api.meno.test';
});

describe('TopBar AI config button', () => {
  it('shows AI config wand button when authenticated', () => {
    const onAiConfig = vi.fn();
    render(<TopBar authenticated={true} githubLogin="user" onLogout={vi.fn()} onAiConfig={onAiConfig} />);
    const btn = screen.getByRole('button', { name: 'AI 配置' });
    fireEvent.click(btn);
    expect(onAiConfig).toHaveBeenCalled();
  });

  it('does not show AI config button when not authenticated', () => {
    render(<TopBar authenticated={false} githubLogin={null} onLogout={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'AI 配置' })).toBeNull();
  });
});
