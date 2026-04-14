# Voice Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice-note creation to meno so users can record audio in the composer, save it as part of a memo, and render audio-first memos while keeping transcript handling asynchronous and non-blocking.

**Architecture:** Extend the worker data model with a dedicated `memo_voice_notes` table and repository, then thread optional `voiceNote` data through memo create/read APIs and shared types. On the frontend, add a `MediaRecorder`-based state machine inside `MemoComposer`, then render voice-note players in memo cards and detail pages with desktop/mobile-friendly layout and pending transcript placeholders.

**Tech Stack:** React 19, Vite, Vitest, Hono, Cloudflare Workers, D1, R2, TypeScript

---

## File Map

- Create: `worker/migrations/005_add_memo_voice_notes.sql`
- Create: `worker/src/db/memo-voice-note-repository.ts`
- Create: `worker/src/lib/voice-transcription.ts`
- Create: `worker/src/test/memo-voice-note-repository.test.ts`
- Create: `worker/src/test/voice-note-route.test.ts`
- Create: `frontend/src/test/memo-composer-voice-note.test.tsx`
- Create: `frontend/src/test/memo-card-voice-note.test.tsx`
- Create: `frontend/src/test/memo-detail-voice-note.test.tsx`
- Modify: `worker/src/db/schema.ts`
- Modify: `worker/src/db/memo-repository.ts`
- Modify: `worker/src/db/client.ts`
- Modify: `worker/src/routes/memos.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/test/route-test-helpers.ts`
- Modify: `shared/src/types.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/MemoComposer.tsx`
- Modify: `frontend/src/components/MemoCard.tsx`
- Modify: `frontend/src/pages/MemoDetailPage.tsx`

## Task 1: Add Voice Note Schema And Repository Support

**Files:**
- Create: `worker/migrations/005_add_memo_voice_notes.sql`
- Create: `worker/src/db/memo-voice-note-repository.ts`
- Create: `worker/src/test/memo-voice-note-repository.test.ts`
- Modify: `worker/src/db/schema.ts`
- Modify: `worker/src/db/memo-repository.ts`
- Modify: `worker/src/test/route-test-helpers.ts`
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Write the failing repository test for creating and reading a voice note**

```ts
import { describe, expect, it } from 'vitest';
import { applySchema } from '../db/schema';
import { createMemo, getAuthorMemoById } from '../db/memo-repository';
import { createOrReplaceVoiceNote, getVoiceNoteByMemoId } from '../db/memo-voice-note-repository';
import { createTestD1 } from './d1-test-helpers';

describe('memo voice note repository', () => {
  it('stores and loads a voice note for a memo', async () => {
    const db = createTestD1();
    applySchema(db);

    const memo = await createMemo(db, {
      slug: 'voice-note-memo',
      content: '',
      visibility: 'private',
      displayDate: '2026-04-13',
    });

    await createOrReplaceVoiceNote(db, {
      memoId: memo.id,
      objectKey: 'uploads/2026/04/voice.webm',
      audioUrl: 'https://api.meno.guoyingwei.top/api/assets/uploads/2026/04/voice.webm',
      mimeType: 'audio/webm',
      durationMs: 7000,
      transcriptStatus: 'pending',
      transcriptText: null,
      transcriptSource: null,
    });

    const voiceNote = await getVoiceNoteByMemoId(db, memo.id);
    const fullMemo = await getAuthorMemoById(db, memo.id);

    expect(voiceNote).toEqual(expect.objectContaining({
      memoId: memo.id,
      objectKey: 'uploads/2026/04/voice.webm',
      transcriptStatus: 'pending',
      durationMs: 7000,
    }));
    expect(fullMemo?.voiceNote).toEqual(expect.objectContaining({
      audioUrl: 'https://api.meno.guoyingwei.top/api/assets/uploads/2026/04/voice.webm',
      transcriptStatus: 'pending',
    }));
  });
});
```

- [ ] **Step 2: Run the repository test to verify it fails**

Run: `npm run test --workspace worker -- memo-voice-note-repository.test.ts`

Expected: FAIL with missing module `../db/memo-voice-note-repository` and missing `voiceNote` type fields on `MemoDetail`.

- [ ] **Step 3: Add the D1 migration and schema support**

```sql
CREATE TABLE IF NOT EXISTS memo_voice_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id INTEGER NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  transcript_text TEXT,
  transcript_source TEXT,
  transcript_error TEXT,
  transcript_attempts INTEGER NOT NULL DEFAULT 0,
  transcript_started_at TEXT,
  transcript_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memo_voice_notes_status_updated_at
  ON memo_voice_notes (transcript_status, updated_at);
```

```ts
export interface MemoVoiceNote {
  memoId: number;
  objectKey: string;
  audioUrl: string;
  mimeType: string;
  durationMs: number;
  transcriptStatus: 'pending' | 'processing' | 'done' | 'failed' | 'not_available';
  transcriptText: string | null;
  transcriptSource: 'browser-native' | 'server-queue' | null;
}

export interface MemoSummary {
  id: number;
  slug: string;
  content: string;
  excerpt: string;
  visibility: MemoVisibility;
  displayDate: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  favoritedAt: string | null;
  previousVisibility: MemoVisibility | null;
  hasImages: boolean;
  imageCount: number;
  tagCount: number;
  tags: string[];
  voiceNote?: MemoVoiceNote;
}
```

- [ ] **Step 4: Implement the voice-note repository and memo attachment helper**

```ts
export const createOrReplaceVoiceNote = async (db: D1Database, input: CreateVoiceNoteInput) => {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO memo_voice_notes
      (memo_id, object_key, audio_url, mime_type, duration_ms, transcript_status, transcript_text, transcript_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(memo_id) DO UPDATE SET
       object_key = excluded.object_key,
       audio_url = excluded.audio_url,
       mime_type = excluded.mime_type,
       duration_ms = excluded.duration_ms,
       transcript_status = excluded.transcript_status,
       transcript_text = excluded.transcript_text,
       transcript_source = excluded.transcript_source,
       updated_at = excluded.updated_at`
  ).bind(
    input.memoId,
    input.objectKey,
    input.audioUrl,
    input.mimeType,
    input.durationMs,
    input.transcriptStatus,
    input.transcriptText,
    input.transcriptSource,
    now,
    now,
  ).run();
};

const attachVoiceNotes = async (db: D1Database, memos: MemoSummary[]) => {
  if (memos.length === 0) return memos;
  const placeholders = memos.map(() => '?').join(', ');
  const { results } = await db.prepare(
    `SELECT * FROM memo_voice_notes WHERE memo_id IN (${placeholders})`
  ).bind(...memos.map((memo) => memo.id)).all();
  const byMemoId = new Map((results ?? []).map((row) => [Number((row as Record<string, unknown>).memo_id), mapVoiceNoteRow(row)]));
  return memos.map((memo) => ({ ...memo, voiceNote: byMemoId.get(memo.id) }));
};
```

- [ ] **Step 5: Update memo repository reads to include `voiceNote`**

```ts
const attachMemoRelations = async (db: D1Database, memos: MemoSummary[]) => {
  const withTags = await attachTags(db, memos);
  return attachVoiceNotes(db, withTags);
};

export const getAuthorMemoById = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachMemoRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};
```

- [ ] **Step 6: Run the repository test to verify it passes**

Run: `npm run test --workspace worker -- memo-voice-note-repository.test.ts`

Expected: PASS with 1 test passing.

- [ ] **Step 7: Commit the schema and repository slice**

```bash
git add worker/migrations/005_add_memo_voice_notes.sql worker/src/db/schema.ts worker/src/db/memo-repository.ts worker/src/db/memo-voice-note-repository.ts worker/src/test/memo-voice-note-repository.test.ts worker/src/test/route-test-helpers.ts shared/src/types.ts
git commit -m "feat(worker): add memo voice note data model"
```

## Task 2: Support Voice Notes In Memo Create And Read APIs

**Files:**
- Create: `worker/src/test/voice-note-route.test.ts`
- Modify: `worker/src/routes/memos.ts`
- Modify: `worker/src/db/memo-repository.ts`
- Modify: `worker/src/test/route-test-helpers.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Write the failing route test for memo creation with `voiceNote`**

```ts
import { describe, expect, it } from 'vitest';
import type { MemoDetail } from '../../../shared/src/types';
import { app } from '../index';
import { createTestEnv } from './route-test-helpers';

describe('voice note memo route', () => {
  it('creates a memo with a voice note payload', async () => {
    const env = await createTestEnv();

    const response = await app.request('http://localhost/api/memos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'meno_session=valid-author-session',
      },
      body: JSON.stringify({
        content: '',
        visibility: 'private',
        displayDate: '2026-04-13',
        voiceNote: {
          objectKey: 'uploads/2026/04/test.webm',
          audioUrl: 'https://api.meno.guoyingwei.top/api/assets/uploads/2026/04/test.webm',
          mimeType: 'audio/webm',
          durationMs: 4200,
        },
      }),
    }, env);

    expect(response.status).toBe(201);
    const payload = await response.json() as { memo: MemoDetail };
    expect(payload.memo.voiceNote).toEqual(expect.objectContaining({
      objectKey: 'uploads/2026/04/test.webm',
      transcriptStatus: 'not_available',
    }));
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npm run test --workspace worker -- voice-note-route.test.ts`

Expected: FAIL because `POST /api/memos` ignores `voiceNote` and response lacks `memo.voiceNote`.

- [ ] **Step 3: Extend the route and API input types**

```ts
const body = await c.req.json<{
  content: string;
  visibility: 'public' | 'private';
  displayDate: string;
  voiceNote?: {
    objectKey: string;
    audioUrl: string;
    mimeType: string;
    durationMs: number;
  };
}>();
```

```ts
export const createMemo = async (input: {
  content: string;
  visibility: 'public' | 'private';
  displayDate: string;
  voiceNote?: {
    objectKey: string;
    audioUrl: string;
    mimeType: string;
    durationMs: number;
  };
}): Promise<{ memo: MemoDetail }> => {
  const response = await fetch(withApiBase('/api/memos'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error('Failed to create memo');
  }
  return response.json();
};
```

- [ ] **Step 4: Persist `voiceNote` when creating a memo and default transcript state safely**

```ts
const memo = await createMemo(c.env.DB, {
  slug: createMemoSlug(),
  content: body.content,
  visibility: body.visibility,
  displayDate: body.displayDate,
});

if (body.voiceNote) {
  await createOrReplaceVoiceNote(c.env.DB, {
    memoId: memo.id,
    objectKey: body.voiceNote.objectKey,
    audioUrl: body.voiceNote.audioUrl,
    mimeType: body.voiceNote.mimeType,
    durationMs: body.voiceNote.durationMs,
    transcriptStatus: 'not_available',
    transcriptText: null,
    transcriptSource: null,
  });
}

const memoWithVoice = await getAuthorMemoById(c.env.DB, memo.id);
return c.json({ memo: memoWithVoice ?? memo }, 201);
```

- [ ] **Step 5: Run the worker route tests for memo creation**

Run: `npm run test --workspace worker -- create-memo-route.test.ts voice-note-route.test.ts`

Expected: PASS with both ordinary memo creation and voice-note memo creation succeeding.

- [ ] **Step 6: Commit the route and API slice**

```bash
git add worker/src/routes/memos.ts worker/src/db/memo-repository.ts worker/src/test/voice-note-route.test.ts worker/src/test/create-memo-route.test.ts frontend/src/lib/api.ts shared/src/types.ts
git commit -m "feat(worker): accept voice note memo payloads"
```

## Task 3: Add Composer Recording Flow And Save Sequence

**Files:**
- Create: `frontend/src/test/memo-composer-voice-note.test.tsx`
- Modify: `frontend/src/components/MemoComposer.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/test/setup.ts`
- Modify: `frontend/src/test/memo-composer.test.tsx`

- [ ] **Step 1: Write the failing frontend test for record-review-save flow**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoComposer } from '../components/MemoComposer';

describe('MemoComposer voice note flow', () => {
  it('uploads recorded audio and submits voiceNote metadata after review', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const stream = {} as MediaStream;
    const stop = vi.fn();
    const mediaRecorder = {
      start: vi.fn(),
      stop,
      state: 'inactive',
      ondataavailable: null as ((event: BlobEvent) => void) | null,
      onstop: null as (() => void) | null,
    };

    vi.stubGlobal('MediaRecorder', vi.fn(() => mediaRecorder));
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://cdn.example.com/uploads/voice.webm',
      objectKey: 'uploads/voice.webm',
      fileName: 'voice.webm',
    }), { headers: { 'Content-Type': 'application/json' } })));

    render(<MemoComposer defaultDisplayDate="2026-04-13" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止录音' }));
    mediaRecorder.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) } as BlobEvent);
    mediaRecorder.onstop?.();

    fireEvent.click(await screen.findByRole('button', { name: '保存语音笔记' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        content: '',
        displayDate: '2026-04-13',
        voiceNote: expect.objectContaining({
          objectKey: 'uploads/voice.webm',
          mimeType: 'audio/webm',
        }),
      }));
    });
  });
});
```

- [ ] **Step 2: Run the frontend voice-note composer test to verify it fails**

Run: `npm run test --workspace frontend -- memo-composer-voice-note.test.tsx`

Expected: FAIL because `MemoComposer` has no recording controls and submit payload does not include `voiceNote`.

- [ ] **Step 3: Extend composer submit types and recording state**

```ts
interface MemoComposerSubmitInput {
  content: string;
  visibility: 'public' | 'private';
  displayDate: string;
  voiceNote?: {
    objectKey: string;
    audioUrl: string;
    mimeType: string;
    durationMs: number;
  };
}

type RecordingState = 'idle' | 'recording' | 'review' | 'saving';
```

```ts
const [recordingState, setRecordingState] = useState<RecordingState>('idle');
const [audioDraft, setAudioDraft] = useState<{
  blob: Blob;
  previewUrl: string;
  durationMs: number;
  mimeType: string;
} | null>(null);
```

- [ ] **Step 4: Implement `MediaRecorder` start/stop/review helpers and audio upload**

```ts
const uploadAudio = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${getApiBase()}/api/uploads`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  return response.json() as Promise<{ url: string; objectKey: string; fileName: string }>;
};

const startRecording = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const startedAt = Date.now();
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    setAudioDraft({
      blob,
      previewUrl: URL.createObjectURL(blob),
      durationMs: Date.now() - startedAt,
      mimeType: recorder.mimeType || 'audio/webm',
    });
    setRecordingState('review');
    stream.getTracks().forEach((track) => track.stop());
  };
  recorder.start();
  mediaRecorderRef.current = recorder;
  setRecordingState('recording');
};
```

- [ ] **Step 5: Implement desktop/mobile-friendly review panel and submit sequence**

```tsx
{audioDraft ? (
  <div style={isNarrow ? styles.mobileVoicePanel : styles.voicePanel}>
    <audio controls src={audioDraft.previewUrl} style={styles.voicePlayer} />
    <div style={isNarrow ? styles.mobileVoiceActions : styles.voiceActions}>
      <button type="button" onClick={resetVoiceDraft}>取消</button>
      <button type="button" onClick={restartRecording}>重录</button>
      <button type="button" onClick={handleSubmit}>保存</button>
    </div>
  </div>
) : null}
```

```ts
if (audioDraft) {
  const ext = audioDraft.mimeType.includes('mpeg') ? 'mp3' : 'webm';
  const upload = await uploadAudio(new File([audioDraft.blob], `voice-note.${ext}`, { type: audioDraft.mimeType }));
  voiceNote = {
    objectKey: upload.objectKey,
    audioUrl: upload.url,
    mimeType: audioDraft.mimeType,
    durationMs: audioDraft.durationMs,
  };
}
await onSubmit({ content: fullContent, visibility, displayDate, voiceNote });
```

- [ ] **Step 6: Run focused frontend composer tests**

Run: `npm run test --workspace frontend -- memo-composer.test.tsx memo-composer-voice-note.test.tsx memo-composer-upload-preview.test.tsx`

Expected: PASS with ordinary text/image behavior unchanged and new voice-note flow passing.

- [ ] **Step 7: Commit the composer slice**

```bash
git add frontend/src/components/MemoComposer.tsx frontend/src/lib/api.ts frontend/src/test/setup.ts frontend/src/test/memo-composer.test.tsx frontend/src/test/memo-composer-voice-note.test.tsx
git commit -m "feat(frontend): add voice note composer flow"
```

## Task 4: Render Voice Notes In Timeline Cards And Detail Page

**Files:**
- Create: `frontend/src/test/memo-card-voice-note.test.tsx`
- Create: `frontend/src/test/memo-detail-voice-note.test.tsx`
- Modify: `frontend/src/components/MemoCard.tsx`
- Modify: `frontend/src/pages/MemoDetailPage.tsx`
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Write the failing rendering tests**

```tsx
it('renders an audio player and pending placeholder for a voice-note memo card', () => {
  const { container } = render(<MemoCard memo={{
    id: 1,
    slug: 'voice-note',
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
    },
  }} />);

  expect(container.querySelector('audio')).not.toBeNull();
  expect(screen.getByText('语音已保存，等待转写')).toBeInTheDocument();
});
```

```tsx
it('renders voice-note audio above memo content on the detail page', async () => {
  vi.mock('../lib/api', async () => ({
    fetchMe: async () => ({ authenticated: true, role: 'author', githubLogin: 'guoyingwei6' }),
    fetchAuthorMemo: async () => ({
      memo: {
        id: 1,
        slug: 'voice-note',
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
        },
      },
    }),
    fetchPublicMemo: async () => { throw new Error('not used'); },
    pinMemo: async () => ({ memo: null }),
    unpinMemo: async () => ({ memo: null }),
  }));
  expect(await screen.findByText('已经生成的转写正文')).toBeInTheDocument();
  expect(screen.getByTitle('语音笔记播放器')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the rendering tests to verify they fail**

Run: `npm run test --workspace frontend -- memo-card-voice-note.test.tsx memo-detail-voice-note.test.tsx`

Expected: FAIL because `MemoCard` and `MemoDetailPage` do not render voice-note UI.

- [ ] **Step 3: Add a shared renderer for the voice-note player block**

```tsx
const VoiceNoteBlock = ({ voiceNote }: { voiceNote: MemoSummary['voiceNote'] }) => {
  if (!voiceNote) return null;
  return (
    <div style={styles.voiceBlock}>
      <audio controls preload="none" src={voiceNote.audioUrl} title="语音笔记播放器" style={styles.voiceAudio} />
      {voiceNote.transcriptStatus !== 'done' ? (
        <p style={styles.voicePending}>语音已保存，等待转写</p>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 4: Render the voice-note block before markdown content and keep mobile layout readable**

```tsx
<div style={{ borderRadius: 12, background: c.cardBg, border: `1px solid ${c.border}`, padding: isMobile ? '14px 14px' : '16px 20px' }}>
  <VoiceNoteBlock voiceNote={memo.voiceNote} />
  <ReactMarkdown>{stripTagSyntax(memo.content)}</ReactMarkdown>
</div>
```

```ts
voiceBlock: {
  marginBottom: 14,
  padding: '12px 14px',
  borderRadius: 12,
  background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
}
```

- [ ] **Step 5: Run focused rendering tests**

Run: `npm run test --workspace frontend -- memo-card-voice-note.test.tsx memo-detail-voice-note.test.tsx memo-detail-page.test.tsx`

Expected: PASS with voice-note rendering covered and existing memo detail behavior intact.

- [ ] **Step 6: Commit the rendering slice**

```bash
git add frontend/src/components/MemoCard.tsx frontend/src/pages/MemoDetailPage.tsx frontend/src/test/memo-card-voice-note.test.tsx frontend/src/test/memo-detail-voice-note.test.tsx shared/src/types.ts
git commit -m "feat(frontend): render voice note memos"
```

## Task 5: Add Async Transcript Status Plumbing And Scheduled Stub

**Files:**
- Create: `worker/src/lib/voice-transcription.ts`
- Modify: `worker/src/db/memo-voice-note-repository.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/test/route-test-helpers.ts`
- Modify: `worker/src/test/voice-note-route.test.ts`

- [ ] **Step 1: Write the failing worker test for scheduled voice-note processing**

```ts
it('marks pending voice notes as not_available when no transcription engine exists', async () => {
  const env = await createTestEnv();
  const memo = await createMemo(env.DB, {
    slug: 'scheduled-voice-note',
    content: '',
    visibility: 'private',
    displayDate: '2026-04-13',
  });
  await createOrReplaceVoiceNote(env.DB, {
    memoId: memo.id,
    objectKey: 'uploads/voice.webm',
    audioUrl: 'https://api.meno.guoyingwei.top/api/assets/uploads/voice.webm',
    mimeType: 'audio/webm',
    durationMs: 5000,
    transcriptStatus: 'pending',
    transcriptText: null,
    transcriptSource: null,
  });
  await app.scheduled?.({} as ScheduledEvent, env);
  const updatedMemo = await getAuthorMemoById(env.DB, memo.id);
  expect(updatedMemo?.voiceNote?.transcriptStatus).toBe('not_available');
});
```

- [ ] **Step 2: Run the worker test to verify it fails**

Run: `npm run test --workspace worker -- voice-note-route.test.ts`

Expected: FAIL because scheduled processing never touches `memo_voice_notes`.

- [ ] **Step 3: Add repository helpers for pending selection and status updates**

```ts
export const listPendingVoiceNotes = async (db: D1Database, limit = 10) => {
  const { results } = await db.prepare(
    `SELECT * FROM memo_voice_notes WHERE transcript_status IN ('pending', 'processing') ORDER BY updated_at ASC LIMIT ?`
  ).bind(limit).all();
  return (results ?? []).map((row) => mapVoiceNoteRow(row as Record<string, unknown>));
};

export const updateVoiceNoteTranscriptStatus = async (
  db: D1Database,
  memoId: number,
  input: { transcriptStatus: MemoVoiceNote['transcriptStatus']; transcriptError?: string | null }
) => {
  await db.prepare(
    `UPDATE memo_voice_notes SET transcript_status = ?, transcript_error = ?, updated_at = ? WHERE memo_id = ?`
  ).bind(input.transcriptStatus, input.transcriptError ?? null, new Date().toISOString(), memoId).run();
};
```

- [ ] **Step 4: Implement a no-engine scheduled stub that preserves async structure**

```ts
export const processVoiceNoteQueue = async (env: WorkerBindings) => {
  const pending = await listPendingVoiceNotes(env.DB, 10);
  for (const voiceNote of pending) {
    await updateVoiceNoteTranscriptStatus(env.DB, voiceNote.memoId, {
      transcriptStatus: 'not_available',
      transcriptError: 'No transcription engine configured',
    });
  }
};
```

```ts
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: WorkerBindings) {
    const { processMemoImageOcrQueue } = await import('./lib/image-ocr');
    const { processVoiceNoteQueue } = await import('./lib/voice-transcription');
    await purgeOldTrash(env.DB, env.ASSETS);
    await backupMemosToR2(env.DB, env.ASSETS);
    await processMemoImageOcrQueue(env);
    await processVoiceNoteQueue(env);
  },
};
```

- [ ] **Step 5: Run focused worker tests**

Run: `npm run test --workspace worker -- memo-voice-note-repository.test.ts voice-note-route.test.ts`

Expected: PASS with async status plumbing covered and no sync transcript dependency introduced.

- [ ] **Step 6: Commit the async-status slice**

```bash
git add worker/src/lib/voice-transcription.ts worker/src/db/memo-voice-note-repository.ts worker/src/index.ts worker/src/test/route-test-helpers.ts worker/src/test/voice-note-route.test.ts
git commit -m "feat(worker): add voice note transcript queue stub"
```

## Task 6: Final Verification And Cleanup

**Files:**
- Modify: any touched files from Tasks 1-5

- [ ] **Step 1: Run frontend test suites covering changed behavior**

Run: `npm run test --workspace frontend -- memo-composer.test.tsx memo-composer-voice-note.test.tsx memo-card-voice-note.test.tsx memo-detail-voice-note.test.tsx`

Expected: PASS with all voice-note UI tests green.

- [ ] **Step 2: Run worker test suites covering changed behavior**

Run: `npm run test --workspace worker -- create-memo-route.test.ts voice-note-route.test.ts memo-voice-note-repository.test.ts`

Expected: PASS with route and repository coverage green.

- [ ] **Step 3: Run typechecks**

Run: `npm run typecheck`

Expected: PASS for both `frontend` and `worker`.

- [ ] **Step 4: Run the full project test command**

Run: `npm test`

Expected: PASS for both workspaces with no regressions in existing tests.

- [ ] **Step 5: Review the diff for unintended UI or API drift**

Run: `git diff --stat HEAD~5..HEAD`

Expected: only voice-note-related files and tests are touched.

- [ ] **Step 6: Create the final implementation commit if any verification fixes were needed**

```bash
git add frontend/src/components/MemoComposer.tsx frontend/src/components/MemoCard.tsx frontend/src/pages/MemoDetailPage.tsx frontend/src/lib/api.ts frontend/src/test/memo-composer-voice-note.test.tsx frontend/src/test/memo-card-voice-note.test.tsx frontend/src/test/memo-detail-voice-note.test.tsx worker/migrations/005_add_memo_voice_notes.sql worker/src/db/memo-voice-note-repository.ts worker/src/db/memo-repository.ts worker/src/lib/voice-transcription.ts worker/src/routes/memos.ts worker/src/index.ts worker/src/test/memo-voice-note-repository.test.ts worker/src/test/voice-note-route.test.ts shared/src/types.ts
git commit -m "feat: add voice note memos"
```

## Self-Review

### Spec coverage

- Composer voice button before image button: covered in Task 3.
- Recording, review, save flow: covered in Task 3.
- Audio-first memo rendering on desktop and mobile web: covered in Task 4.
- Separate voice-note data model: covered in Task 1.
- API create/read support: covered in Task 2.
- Async transcript queue and non-blocking fallback: covered in Task 5.
- Verification and regression checks: covered in Task 6.

### Placeholder scan

- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Each code-changing step includes concrete code or schema snippets.
- Each test step includes exact files and commands.

### Type consistency

- `voiceNote` is used consistently across shared types, worker responses, and frontend props.
- `transcriptStatus` values are consistently `pending | processing | done | failed | not_available`.
- `objectKey`, `audioUrl`, `mimeType`, and `durationMs` are named consistently across API, repository, and UI steps.
