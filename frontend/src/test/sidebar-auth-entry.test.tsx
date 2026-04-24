import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarShell } from '../components/SidebarShell';

const assignMock = vi.fn();

Object.defineProperty(window, 'location', {
  value: { assign: assignMock },
  writable: true,
});

beforeEach(() => {
  (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ = 'https://api.meno.guoyingwei.top';
  assignMock.mockReset();
});

describe('SidebarShell auth entry', () => {
  it('shows GitHub login in the sidebar brand row for viewers', () => {
    render(
      <SidebarShell
        memoCount={1}
        tagCount={1}
        streakDays={1}
        authenticated={false}
        githubLogin={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'GitHub 登录' }));

    expect(assignMock).toHaveBeenCalledWith('https://api.meno.guoyingwei.top/api/auth/github/login');
  });

  it('shows author identity and logout in the sidebar brand row after login', () => {
    const onLogout = vi.fn();

    render(
      <SidebarShell
        memoCount={1}
        tagCount={1}
        streakDays={1}
        authenticated={true}
        githubLogin="guoyingwei"
        onLogout={onLogout}
      />,
    );

    expect(screen.getByText('@guoyingwei')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
