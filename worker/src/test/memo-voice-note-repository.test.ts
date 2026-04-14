import { beforeEach, describe, expect, it } from 'vitest';
import { createMemo, getAuthorMemoById, getPublicMemoBySlug, listPublicMemos } from '../db/memo-repository';
import { getMemoVoiceNoteByMemoId, upsertMemoVoiceNote } from '../db/memo-voice-note-repository';
import { applySchema } from '../db/schema';
import { createTestD1 } from './d1-test-helpers';

describe('memo voice note repository', () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestD1();
    applySchema(db);
  });

  const createVoiceNoteMemo = async () => {
    const memo = await createMemo(db, {
      slug: 'memo-with-voice-note',
      content: 'Voice note memo #audio',
      visibility: 'public',
      displayDate: '2026-04-01',
    });

    await upsertMemoVoiceNote(db, {
      memoId: memo.id,
      objectKey: 'voice-notes/memo-with-voice-note-v1',
      audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v1.m4a',
      mimeType: 'audio/mp4',
      durationMs: 10_000,
      transcriptStatus: 'processing',
      transcriptAttempts: 1,
      transcriptStartedAt: '2026-04-01T10:00:00.000Z',
    });

    return memo;
  };

  it('preserves transcript metadata when only same-audio metadata changes', async () => {
    const memo = await createVoiceNoteMemo();

    await upsertMemoVoiceNote(db, {
      memoId: memo.id,
      objectKey: 'voice-notes/memo-with-voice-note-v1',
      audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v1.m4a',
      mimeType: 'audio/mp4',
      durationMs: 10_000,
      transcriptStatus: 'done',
      transcriptText: 'Hello from the memo voice note',
      transcriptSource: 'whisper',
      transcriptAttempts: 2,
      transcriptStartedAt: '2026-04-01T10:00:00.000Z',
      transcriptCompletedAt: '2026-04-01T10:05:00.000Z',
    });

    const partialUpdate = await upsertMemoVoiceNote(db, {
      memoId: memo.id,
      objectKey: 'voice-notes/memo-with-voice-note-v1',
      audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v1.m4a',
      mimeType: 'audio/mp4',
      durationMs: 10_000,
    });

    expect(partialUpdate).toEqual(
      expect.objectContaining({
        memoId: memo.id,
        objectKey: 'voice-notes/memo-with-voice-note-v1',
        audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v1.m4a',
        transcriptStatus: 'done',
        transcriptText: 'Hello from the memo voice note',
        transcriptSource: 'whisper',
        transcriptAttempts: 2,
      }),
    );
  });

  it('clears stale transcript metadata when replacing audio with a new asset', async () => {
    const memo = await createVoiceNoteMemo();

    await upsertMemoVoiceNote(db, {
      memoId: memo.id,
      objectKey: 'voice-notes/memo-with-voice-note-v1',
      audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v1.m4a',
      mimeType: 'audio/mp4',
      durationMs: 10_000,
      transcriptStatus: 'done',
      transcriptText: 'Hello from the memo voice note',
      transcriptSource: 'whisper',
      transcriptAttempts: 2,
      transcriptStartedAt: '2026-04-01T10:00:00.000Z',
      transcriptCompletedAt: '2026-04-01T10:05:00.000Z',
    });

    const replaced = await upsertMemoVoiceNote(db, {
      memoId: memo.id,
      objectKey: 'voice-notes/memo-with-voice-note-v2',
      audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v2.m4a',
      mimeType: 'audio/webm',
      durationMs: 11_222,
    });

    expect(replaced).toEqual(
      expect.objectContaining({
        objectKey: 'voice-notes/memo-with-voice-note-v2',
        audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v2.m4a',
        mimeType: 'audio/webm',
        durationMs: 11_222,
        transcriptStatus: 'pending',
        transcriptText: null,
        transcriptSource: null,
        transcriptError: null,
        transcriptAttempts: 0,
        transcriptStartedAt: null,
        transcriptCompletedAt: null,
      }),
    );
  });

  it('returns null when a memo has no voice note', async () => {
    const memo = await createMemo(db, {
      slug: 'memo-without-voice-note',
      content: 'No voice note here',
      visibility: 'public',
      displayDate: '2026-04-01',
    });

    expect(await getMemoVoiceNoteByMemoId(db, memo.id)).toBeNull();
  });

  it('threads voice notes through memo reads and cascades on memo delete', async () => {
    const memo = await createVoiceNoteMemo();

    await upsertMemoVoiceNote(db, {
      memoId: memo.id,
      objectKey: 'voice-notes/memo-with-voice-note-v1',
      audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v1.m4a',
      mimeType: 'audio/mp4',
      durationMs: 10_000,
      transcriptStatus: 'done',
      transcriptText: 'Hello from the memo voice note',
      transcriptSource: 'whisper',
      transcriptAttempts: 2,
      transcriptStartedAt: '2026-04-01T10:00:00.000Z',
      transcriptCompletedAt: '2026-04-01T10:05:00.000Z',
    });

    const memoById = await getAuthorMemoById(db, memo.id);
    expect(memoById?.voiceNote).toEqual(
      expect.objectContaining({
        memoId: memo.id,
        objectKey: 'voice-notes/memo-with-voice-note-v1',
        audioUrl: 'https://cdn.example.com/voice-notes/memo-with-voice-note-v1.m4a',
        transcriptStatus: 'done',
        transcriptText: 'Hello from the memo voice note',
      }),
    );

    const publicMemos = await listPublicMemos(db, {});
    expect(publicMemos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'memo-with-voice-note',
          voiceNote: expect.objectContaining({
            objectKey: 'voice-notes/memo-with-voice-note-v1',
            transcriptStatus: 'done',
          }),
        }),
      ]),
    );

    const publicMemo = await getPublicMemoBySlug(db, 'memo-with-voice-note');
    expect(publicMemo?.voiceNote).toEqual(
      expect.objectContaining({
        objectKey: 'voice-notes/memo-with-voice-note-v1',
        transcriptStatus: 'done',
      }),
    );

    await db.prepare('DELETE FROM memos WHERE id = ?').bind(memo.id).run();
    expect(await getMemoVoiceNoteByMemoId(db, memo.id)).toBeNull();
  });
});
