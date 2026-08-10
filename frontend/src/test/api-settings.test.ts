import { describe, expect, it, vi } from 'vitest';
import { fetchAppSettings, updateAppSettings } from '../lib/api';

describe('app settings API', () => {
  it('reads settings with author credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      settings: { siteTitle: '我的 Meno', defaultVisibility: 'private' },
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAppSettings()).resolves.toEqual({
      settings: { siteTitle: '我的 Meno', defaultVisibility: 'private' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/settings', { credentials: 'include' });
  });

  it('patches both supported settings and rejects failed responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        settings: { siteTitle: '新的 Meno', defaultVisibility: 'public' },
      }), { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateAppSettings({ siteTitle: '新的 Meno', defaultVisibility: 'public' })).resolves.toEqual({
      settings: { siteTitle: '新的 Meno', defaultVisibility: 'public' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/dashboard/settings', expect.objectContaining({
      method: 'PATCH',
      credentials: 'include',
      body: JSON.stringify({ siteTitle: '新的 Meno', defaultVisibility: 'public' }),
    }));
    await expect(updateAppSettings({ defaultVisibility: 'private' })).rejects.toThrow('Failed to update app settings');
  });
});
