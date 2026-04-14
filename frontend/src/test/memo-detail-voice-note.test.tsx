import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoDetailPage } from '../pages/MemoDetailPage';
import type { PublicMemoResponse } from '../types/shared';

const mockResponse: PublicMemoResponse = {
  memo: {
    id: 1,
    slug: 'voice-detail',
    content: '已经生成的转写正文',
    excerpt: '已经生成的转写正文',
    visibility: 'private',
    displayDate: '2026-04-13',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    publishedAt: null,
    deletedAt: null,
    pinnedAt: null,
    favoritedAt: null,
    previousVisibility: null,
    hasImages: false,
    imageCount: 0,
    tagCount: 0,
    tags: [],
    assets: [],
    voiceNote: {
      memoId: 1,
      objectKey: 'uploads/voice.webm',
      audioUrl: 'https://cdn.example.com/uploads/voice.webm',
      mimeType: 'audio/webm',
      durationMs: 7000,
      transcriptStatus: 'done',
      transcriptText: '已经生成的转写正文',
      transcriptSource: 'browser-native',
      transcriptError: null,
      transcriptAttempts: 1,
      transcriptStartedAt: '2026-04-13T12:00:05.000Z',
      transcriptCompletedAt: '2026-04-13T12:00:08.000Z',
      createdAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:00:08.000Z',
    },
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

describe('MemoDetailPage voice note', () => {
  it('renders voice-note audio above memo content', async () => {
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/memos/voice-detail']}>
          <Routes>
            <Route path="/memos/:slug" element={<MemoDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('已经生成的转写正文')).toBeInTheDocument();
    expect(container.querySelector('audio')).not.toBeNull();
  });
});
