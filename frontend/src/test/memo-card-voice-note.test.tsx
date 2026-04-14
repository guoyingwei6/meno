import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoCard } from '../components/MemoCard';

describe('MemoCard voice note', () => {
  it('renders a voice player and pending placeholder for voice-note memos', () => {
    const { container } = render(
      <MemoCard
        memo={{
          id: 1,
          slug: 'voice-card',
          content: '',
          excerpt: '',
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
          voiceNote: {
            memoId: 1,
            objectKey: 'uploads/voice.webm',
            audioUrl: 'https://cdn.example.com/uploads/voice.webm',
            mimeType: 'audio/webm',
            durationMs: 7000,
            transcriptStatus: 'pending',
            transcriptText: null,
            transcriptSource: null,
            transcriptError: null,
            transcriptAttempts: 0,
            transcriptStartedAt: null,
            transcriptCompletedAt: null,
            createdAt: '2026-04-13T12:00:00.000Z',
            updatedAt: '2026-04-13T12:00:00.000Z',
          },
        }}
      />,
    );

    expect(container.querySelector('audio')).not.toBeNull();
    expect(screen.getByText('语音已保存，等待转写')).toBeInTheDocument();
  });
});
