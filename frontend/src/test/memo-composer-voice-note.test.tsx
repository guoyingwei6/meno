import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';

describe('MemoComposer voice note flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const prepareReviewedDraft = async ({
    getUserMedia,
    mediaRecorder,
  }: {
    getUserMedia: ReturnType<typeof vi.fn>;
    mediaRecorder: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null;
      onstop: (() => void) | null;
    };
  }) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia,
        },
      },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', vi.fn(() => mediaRecorder));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:voice-note'),
      revokeObjectURL: vi.fn(),
    });

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole('button', { name: '录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止录音' }));

    await act(async () => {
      mediaRecorder.ondataavailable?.({
        data: new Blob(['voice'], { type: 'audio/webm' }),
      } as BlobEvent);
      mediaRecorder.onstop?.();
    });

    expect(await screen.findByRole('button', { name: '保存语音笔记' })).toBeInTheDocument();
  };

  it('uploads recorded audio and submits voiceNote metadata after review', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const trackStop = vi.fn();
    const stream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;
    const mediaRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      mimeType: 'audio/webm',
      ondataavailable: null as ((event: BlobEvent) => void) | null,
      onstop: null as (() => void) | null,
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => stream),
        },
      },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', vi.fn(() => mediaRecorder));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://cdn.example.com/uploads/voice.webm',
      objectKey: 'uploads/voice.webm',
      fileName: 'voice.webm',
    }), { headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:voice-note'),
      revokeObjectURL: vi.fn(),
    });

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '录音' }));

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    fireEvent.click(await screen.findByRole('button', { name: '停止录音' }));

    await act(async () => {
      mediaRecorder.ondataavailable?.({
        data: new Blob(['voice'], { type: 'audio/webm' }),
      } as BlobEvent);
      mediaRecorder.onstop?.();
    });

    expect(await screen.findByRole('button', { name: '保存语音笔记' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存语音笔记' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/uploads', expect.objectContaining({ method: 'POST' }));
      expect(onSubmit).toHaveBeenCalledWith({
        content: '',
        visibility: 'public',
        displayDate: '2026-04-13',
        voiceNote: expect.objectContaining({
          objectKey: 'uploads/voice.webm',
          audioUrl: 'https://cdn.example.com/uploads/voice.webm',
          mimeType: 'audio/webm',
        }),
      });
    });

    expect(trackStop).toHaveBeenCalled();
  });

  it('uses browser-native transcription as content when the textarea is empty', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const trackStop = vi.fn();
    const stream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    const mediaRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      mimeType: 'audio/webm',
      state: 'inactive',
      ondataavailable: null as ((event: BlobEvent) => void) | null,
      onstop: null as (() => void) | null,
    };
    const speechRecognition = {
      lang: 'zh-CN',
      continuous: true,
      interimResults: true,
      start: vi.fn(),
      stop: vi.fn(),
      onresult: null as ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null,
      onerror: null as ((event: { error: string }) => void) | null,
      onend: null as (() => void) | null,
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia,
        },
      },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', vi.fn(() => mediaRecorder));
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: vi.fn(() => speechRecognition),
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://cdn.example.com/uploads/voice.webm',
      objectKey: 'uploads/voice.webm',
      fileName: 'voice.webm',
    }), { headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:voice-note'),
      revokeObjectURL: vi.fn(),
    });

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '录音' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));

    act(() => {
      speechRecognition.onresult?.({
        resultIndex: 0,
        results: [
          [{ transcript: '这是浏览器原生转写' }],
        ] as unknown as ArrayLike<ArrayLike<{ transcript: string }>>,
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: '停止录音' }));

    await act(async () => {
      mediaRecorder.ondataavailable?.({
        data: new Blob(['voice'], { type: 'audio/webm' }),
      } as BlobEvent);
      mediaRecorder.onstop?.();
    });

    fireEvent.click(await screen.findByRole('button', { name: '保存语音笔记' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        content: '这是浏览器原生转写',
        visibility: 'public',
        displayDate: '2026-04-13',
        voiceNote: expect.objectContaining({
          objectKey: 'uploads/voice.webm',
          transcriptText: '这是浏览器原生转写',
          transcriptSource: 'browser-native',
        }),
      });
    });

    expect(speechRecognition.start).toHaveBeenCalled();
    expect(speechRecognition.stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it('prefers mp4 recording on mobile-compatible browsers and uploads an m4a file', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    const mediaRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      mimeType: 'audio/mp4',
      ondataavailable: null as ((event: BlobEvent) => void) | null,
      onstop: null as (() => void) | null,
    };
    const mediaRecorderCtor = vi.fn(() => mediaRecorder);
    Object.assign(mediaRecorderCtor, {
      isTypeSupported: vi.fn((mimeType: string) => mimeType === 'audio/mp4'),
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia,
        },
      },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', mediaRecorderCtor);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://cdn.example.com/uploads/voice.m4a',
      objectKey: 'uploads/voice.m4a',
      fileName: 'voice.m4a',
    }), { headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:voice-note'),
      revokeObjectURL: vi.fn(),
    });

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '录音' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    expect(mediaRecorderCtor).toHaveBeenCalledWith(stream, { mimeType: 'audio/mp4' });

    fireEvent.click(await screen.findByRole('button', { name: '停止录音' }));

    await act(async () => {
      mediaRecorder.ondataavailable?.({
        data: new Blob(['voice'], { type: 'audio/mp4' }),
      } as BlobEvent);
      mediaRecorder.onstop?.();
    });

    fireEvent.click(await screen.findByRole('button', { name: '保存语音笔记' }));

    await waitFor(async () => {
      const [, request] = vi.mocked(fetch).mock.calls[0] ?? [];
      const body = request?.body as FormData;
      const uploadedFile = body.get('file');
      expect(uploadedFile).toBeInstanceOf(File);
      expect((uploadedFile as File).name).toBe('voice-note.m4a');
      expect((uploadedFile as File).type).toBe('audio/mp4');
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        voiceNote: expect.objectContaining({
          mimeType: 'audio/mp4',
        }),
      }));
    });
  });

  it('preserves the existing reviewed draft when re-record setup fails', async () => {
    const initialTrackStop = vi.fn();
    const initialStream = {
      getTracks: () => [{ stop: initialTrackStop }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => initialStream);
    const mediaRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      mimeType: 'audio/webm',
      ondataavailable: null as ((event: BlobEvent) => void) | null,
      onstop: null as (() => void) | null,
    };

    await prepareReviewedDraft({ getUserMedia, mediaRecorder });

    getUserMedia.mockRejectedValueOnce(new Error('permission denied'));

    fireEvent.click(screen.getByRole('button', { name: '重录' }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByRole('button', { name: '保存语音笔记' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止录音' })).not.toBeInTheDocument();
  });

  it('stops the acquired stream when recorder setup fails after getUserMedia', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia,
        },
      },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', vi.fn(() => {
      throw new Error('unsupported');
    }));

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole('button', { name: '录音' }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(stop).toHaveBeenCalled();
    });

    expect(screen.queryByRole('button', { name: '停止录音' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存语音笔记' })).not.toBeInTheDocument();
  });

  it('shows recording duration and cancel control while recording', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T10:00:00.000Z'));

    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    const mediaRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      mimeType: 'audio/webm',
      state: 'recording',
      ondataavailable: null as ((event: BlobEvent) => void) | null,
      onstop: null as (() => void) | null,
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia,
        },
      },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', vi.fn(() => mediaRecorder));

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={vi.fn(async () => undefined)} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '录音' }));
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByRole('button', { name: '停止录音' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByText('正在录音 00:03')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消录音' }));

    expect(stop).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '停止录音' })).not.toBeInTheDocument();

  });

  it('disables the voice button with a clear hint when recording is unsupported', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', undefined);

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={vi.fn(async () => undefined)} />);

    const button = screen.getByRole('button', { name: '录音' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '当前浏览器不支持录音');
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});
