import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('meno_ai_config', JSON.stringify({
    url: 'https://models.inference.ai.azure.com',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
  }));

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/me')) {
        return new Response(JSON.stringify({ authenticated: true, role: 'author', githubLogin: 'guoyingwei' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/dashboard/stats')) {
        return new Response(JSON.stringify({
          stats: { total: 12, public: 8, private: 3, draft: 1, trash: 0, tags: 4, streakDays: 20 },
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/api/dashboard/tags')) {
        return new Response(JSON.stringify({ tags: [{ tag: 'meno', count: 2 }] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/ai/index')) {
        return new Response(JSON.stringify({ indexed: 12 }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/api/ai/ocr/status')) {
        return new Response(JSON.stringify({
          total: 6,
          pending: 2,
          processing: 0,
          done: 3,
          failed: 1,
          removed: 0,
          processedToday: 4,
          dailyLimit: 20,
          batchSize: 5,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/api/ai/ocr/run')) {
        return new Response(JSON.stringify({
          processed: 2,
          scanned: 8,
          skipped: 1,
          status: {
            total: 6,
            pending: 1,
            processing: 0,
            done: 5,
            failed: 0,
            removed: 0,
            processedToday: 6,
            dailyLimit: 20,
            batchSize: 5,
          },
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/api/ai/chat')) {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({
          answer: '你最近主要在整理知识库和标签体系。',
          sources: [
            {
              memoId: 1,
              slug: 'memo-1',
              visibility: 'private',
              displayDate: '2026-04-01',
              tags: ['meno'],
              snippet: '最近一直在整理知识库和标签体系。',
            },
            {
              memoId: 2,
              slug: 'memo-2',
              visibility: 'private',
              displayDate: '2026-04-02',
              tags: ['旅行'],
              snippet: '第二条命中资料。',
            },
          ],
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/api/dashboard/memos/memo-1')) {
        return new Response(JSON.stringify({
          memo: {
            id: 1,
            slug: 'memo-1',
            content: '#meno\n最近一直在整理知识库和标签体系。',
            excerpt: '最近一直在整理知识库和标签体系。',
            visibility: 'private',
            displayDate: '2026-04-01',
            createdAt: '2026-04-01T09:00:00.000Z',
            updatedAt: '2026-04-01T09:00:00.000Z',
            publishedAt: null,
            deletedAt: null,
            pinnedAt: null,
            favoritedAt: null,
            previousVisibility: null,
            hasImages: false,
            imageCount: 0,
            tagCount: 1,
            tags: ['meno'],
            assets: [],
          },
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ memos: [], days: [], tags: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('Deep chat modal', () => {
  it('opens from sidebar and chats with the knowledge base', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /深度对话/ }));
    expect(await screen.findByText('重建知识库索引')).toBeInTheDocument();
    expect(await screen.findByText('待处理 2，失败待重试 1，处理中 0，已完成 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重建知识库索引' }));
    expect(await screen.findByText('索引完成，已同步 12 条笔记')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '手动跑一轮 OCR' }));
    expect(await screen.findByText('本轮 OCR 完成：处理 2 张，跳过 1 张，当前待处理 1 张')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('基于我的笔记库，问点更深的问题...'), {
      target: { value: '我最近在想什么？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('你最近主要在整理知识库和标签体系。')).toBeInTheDocument();
    expect(screen.getByText('资料1 · 2026-04-01 · memo-1')).toBeInTheDocument();
    expect(screen.getByText('资料2 · 2026-04-02 · memo-2')).toBeInTheDocument();
    fireEvent.click(screen.getByText('资料1 · 2026-04-01 · memo-1'));
    expect(await screen.findByText('最近一直在整理知识库和标签体系。')).toBeInTheDocument();
    expect(screen.getAllByText('2026-04-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('memo-1').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/ai/chat', expect.objectContaining({ method: 'POST', credentials: 'include' }));
    });
  });

  it('sends on Enter and keeps newline for Cmd/Ctrl+Enter', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /深度对话/ }));
    const input = screen.getByPlaceholderText('基于我的笔记库，问点更深的问题...');

    fireEvent.change(input, { target: { value: '第一行' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(screen.getByDisplayValue('第一行')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('你最近主要在整理知识库和标签体系。')).toBeInTheDocument();
  });
});
