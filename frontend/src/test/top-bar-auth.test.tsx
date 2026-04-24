import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../components/TopBar';

const assignMock = vi.fn();

Object.defineProperty(window, 'location', {
  value: { assign: assignMock },
  writable: true,
});

beforeEach(() => {
  (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ = 'https://api.meno.guoyingwei.top';
  assignMock.mockReset();
});

describe('TopBar auth actions', () => {
  it('does not show GitHub login button for viewer', () => {
    render(<TopBar authenticated={false} githubLogin={null} onLogout={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'GitHub 登录' })).toBeNull();
  });

  it('shows authenticated-only actions and hides the login button for signed-in author', () => {
    render(<TopBar authenticated={true} githubLogin="guoyingwei" onLogout={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'GitHub 登录' })).toBeNull();
    expect(screen.getByRole('button', { name: '导入/导出' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 配置' })).toBeInTheDocument();
  });
});
