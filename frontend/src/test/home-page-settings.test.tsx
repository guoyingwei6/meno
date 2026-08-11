import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';

describe('HomePage settings integration', () => {
  beforeEach(() => {
    let settings = { siteTitle: 'Meno', defaultVisibility: 'private' as const };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/me')) {
        return new Response(JSON.stringify({ authenticated: true, role: 'author', githubLogin: 'guoyingwei' }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/dashboard/settings') && init?.method === 'PATCH') {
        settings = JSON.parse(init.body as string) as typeof settings;
        return new Response(JSON.stringify({ settings }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/dashboard/settings')) {
        return new Response(JSON.stringify({ settings }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/dashboard/tags')) return new Response(JSON.stringify({ tags: [] }), { headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/api/dashboard/stats')) return new Response(JSON.stringify({ stats: { total: 0, public: 0, private: 0, trash: 0, tags: 0, streakDays: 0 } }), { headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/api/dashboard/calendar')) return new Response(JSON.stringify({ days: [] }), { headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/api/dashboard/memos')) return new Response(JSON.stringify({ memos: [] }), { headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ memos: [] }), { headers: { 'Content-Type': 'application/json' } });
    }));
  });

  it('opens settings and applies the saved default visibility to a new Composer', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText('可见性')).toHaveValue('private');
    const settingsButton = await screen.findByRole('button', { name: '设置' });
    expect(screen.getAllByRole('button', { name: /设置/ })).toHaveLength(1);
    fireEvent.click(settingsButton);
    expect(await screen.findByRole('dialog', { name: '设置' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('站点标题'), { target: { value: '我的 Meno' } });
    fireEvent.change(screen.getByLabelText('新建 Memo 默认可见性'), { target: { value: 'public' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('可见性')).toHaveValue('public');
      expect(document.title).toBe('我的 Meno');
    });
    expect(fetch).toHaveBeenCalledWith('/api/dashboard/settings', expect.objectContaining({ method: 'PATCH' }));
  });
});
