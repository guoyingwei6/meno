import { describe, expect, it, vi } from 'vitest';
import { createMemo, fetchDashboardMemos, fetchMe, logout } from '../lib/api';

describe('API auth credentials', () => {
  it('sends credentials for auth-sensitive requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authenticated: false, role: 'viewer', githubLogin: null, memos: [], memo: null, success: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchMe();
    await fetchDashboardMemos('all');
    await createMemo({ content: 'hello', visibility: 'private', displayDate: '2026-03-25' });
    await logout();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/me', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/dashboard/memos?view=all', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/memos', expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });

  it('serializes voiceNote in createMemo requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ memo: null }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createMemo({
      content: 'hello with voice note',
      visibility: 'private',
      displayDate: '2026-03-25',
      voiceNote: {
        objectKey: 'voice-notes/hello.m4a',
        audioUrl: 'https://cdn.example.com/voice-notes/hello.m4a',
        mimeType: 'audio/mp4',
        durationMs: 1234,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/memos',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          content: 'hello with voice note',
          visibility: 'private',
          displayDate: '2026-03-25',
          voiceNote: {
            objectKey: 'voice-notes/hello.m4a',
            audioUrl: 'https://cdn.example.com/voice-notes/hello.m4a',
            mimeType: 'audio/mp4',
            durationMs: 1234,
          },
        }),
      }),
    );
  });
});
