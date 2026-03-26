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
  it('shows GitHub login button for viewer and opens OAuth login route', () => {
    render(<TopBar authenticated={false} githubLogin={null} onLogout={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'GitHub 登录' });
    fireEvent.click(button);

    expect(assignMock).toHaveBeenCalledWith('https://api.meno.guoyingwei.top/api/auth/github/login');
  });

  it('shows author identity and logout button for signed-in author', () => {
    const onLogout = vi.fn();
    render(<TopBar authenticated={true} githubLogin="guoyingwei" onLogout={onLogout} />);

    expect(screen.getByText('@guoyingwei')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
