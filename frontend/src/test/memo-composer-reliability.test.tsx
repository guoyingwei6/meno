import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';
import { deleteDraft, getTabDraftId, readDraft, saveDraft } from '../lib/draft-store';

const uploadResponse = () => new Response(JSON.stringify({
  url: 'https://cdn.example.com/restored.png',
  objectKey: 'uploads/restored.png',
  fileName: 'restored.png',
}), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true, writable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.stubGlobal('fetch', vi.fn(async () => uploadResponse()));
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('MemoComposer reliability', () => {
  it('restores metadata and Blob attachments, then removes the draft after success', async () => {
    const id = getTabDraftId();
    await saveDraft({
      id,
      clientId: 'restored-client',
      content: '恢复正文 #恢复',
      displayDate: '2026-08-08',
      visibility: 'private',
      tags: ['恢复'],
      images: [{ name: 'restored.png', blob: new Blob(['image'], { type: 'image/png' }) }],
      audio: { blob: new Blob(['audio'], { type: 'audio/webm' }), durationMs: 2400, mimeType: 'audio/webm' },
      transcriptText: '录音转写',
      updatedAt: Date.now(),
    });
    const onSubmit = vi.fn(async () => undefined);

    render(<MemoComposer defaultDisplayDate="2026-08-09" onSubmit={onSubmit} />);

    expect(await screen.findByDisplayValue('恢复正文 #恢复')).toBeInTheDocument();
    expect(screen.getByLabelText('可见性')).toHaveValue('private');
    expect(screen.getByLabelText('归属日期')).toHaveValue('2026-08-08');
    expect(screen.getByRole('img', { name: 'restored.png' })).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存语音笔记' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        content: '恢复正文 #恢复\n![](https://cdn.example.com/restored.png)',
        visibility: 'private',
        displayDate: '2026-08-08',
        client_id: 'restored-client',
        voiceNote: expect.objectContaining({
          audioUrl: 'https://cdn.example.com/restored.png',
          transcriptText: '录音转写',
        }),
      }));
    });
    await waitFor(async () => expect(await readDraft(id)).toBeNull());
  });

  it('queues the complete capture while offline without calling the publish API', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const onSubmit = vi.fn(async () => undefined);
    const onQueueOffline = vi.fn(async (draft) => draft);

    render(
      <MemoComposer
        defaultDisplayDate="2026-08-09"
        onSubmit={onSubmit}
        onQueueOffline={onQueueOffline}
        defaultVisibility="private"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), { target: { value: '离线正文 #离线' } });
    fireEvent.change(screen.getByLabelText('归属日期'), { target: { value: '2026-08-01' } });

    fireEvent.click(screen.getAllByRole('button').at(-1)!);

    await waitFor(() => expect(onQueueOffline).toHaveBeenCalledTimes(1));
    expect(onQueueOffline).toHaveBeenCalledWith(expect.objectContaining({
      content: '离线正文 #离线',
      displayDate: '2026-08-01',
      visibility: 'private',
      tags: ['离线'],
      clientId: expect.any(String),
    }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not publish a memo when image upload returns a failure response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'too large' }), { status: 413 })));
    const onSubmit = vi.fn(async () => undefined);
    render(<MemoComposer defaultDisplayDate="2026-08-09" onSubmit={onSubmit} />);

    const file = new File(['image'], 'failed.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传图片'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('img', { name: 'failed.png' })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), { target: { value: '不要半成品' } });
    fireEvent.click(screen.getAllByRole('button').at(-1)!);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('图片上传失败（HTTP 413）'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'failed.png' })).toBeInTheDocument();
  });

  it('rejects unsupported images in the browser before adding or uploading them', async () => {
    const fetchMock = vi.fn(async () => uploadResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoComposer defaultDisplayDate="2026-08-09" onSubmit={vi.fn(async () => undefined)} />);

    const file = new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('上传图片'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('仅支持 JPEG、PNG、WebP、GIF 或 AVIF 图片');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: 'unsafe.svg' })).not.toBeInTheDocument();
  });

  it('reuses the same image client_id when retrying a failed Blob upload', async () => {
    let uploadAttempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/uploads')) {
        uploadAttempt += 1;
        if (uploadAttempt === 1) return new Response('{}', { status: 503 });
        return uploadResponse();
      }
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSubmit = vi.fn(async () => undefined);
    render(<MemoComposer defaultDisplayDate="2026-08-09" onSubmit={onSubmit} />);

    const file = new File(['image'], 'retry.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传图片'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('img', { name: 'retry.png' })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), { target: { value: '重试附件' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const uploadCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return url.endsWith('/api/uploads');
    });
    const clientIds = uploadCalls.map(([, init]) => (init?.body as FormData).get('client_id'));
    expect(uploadAttempt).toBe(2);
    expect(clientIds).toHaveLength(2);
    expect(clientIds[0]).toBe(clientIds[1]);
    expect(clientIds[0]).toEqual(expect.stringContaining(':image:'));
  });

  it('syncs a changed default visibility only while the composer is untouched', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = render(<MemoComposer defaultDisplayDate="2026-08-09" defaultVisibility="private" onSubmit={onSubmit} />);
    expect(screen.getByLabelText('可见性')).toHaveValue('private');

    view.rerender(<MemoComposer defaultDisplayDate="2026-08-09" defaultVisibility="public" onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByLabelText('可见性')).toHaveValue('public'));

    fireEvent.change(screen.getByPlaceholderText('现在的想法是...'), { target: { value: '保留当前选择' } });
    view.rerender(<MemoComposer defaultDisplayDate="2026-08-09" defaultVisibility="private" onSubmit={onSubmit} />);
    expect(screen.getByLabelText('可见性')).toHaveValue('public');
  });

  it('caps auto-grow at min(60vh, 420px) and scrolls only beyond the cap', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true, writable: true });
    render(<MemoComposer defaultDisplayDate="2026-08-09" onSubmit={vi.fn(async () => undefined)} />);
    const textarea = screen.getByPlaceholderText('现在的想法是...') as HTMLTextAreaElement;
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 500 });

    fireEvent.change(textarea, { target: { value: '很长的正文' } });

    await waitFor(() => expect(textarea.style.height).toBe('360px'));
    expect(textarea.style.overflowY).toBe('auto');
  });
});
