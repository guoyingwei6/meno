import type { MemoSummary, MemoVoiceNote } from '../../../shared/src/types';

export interface UpsertMemoVoiceNoteInput {
  memoId: number;
  objectKey: string;
  audioUrl: string;
  mimeType: string;
  durationMs: number;
  transcriptStatus?: MemoVoiceNote['transcriptStatus'];
  transcriptText?: string | null;
  transcriptSource?: string | null;
  transcriptError?: string | null;
  transcriptAttempts?: number;
  transcriptStartedAt?: string | null;
  transcriptCompletedAt?: string | null;
}

const mapVoiceNoteRow = (row: Record<string, unknown>): MemoVoiceNote => ({
  memoId: Number(row.memo_id),
  objectKey: String(row.object_key),
  audioUrl: String(row.audio_url),
  mimeType: String(row.mime_type),
  durationMs: Number(row.duration_ms),
  transcriptStatus: String(row.transcript_status) as MemoVoiceNote['transcriptStatus'],
  transcriptText: row.transcript_text !== null && row.transcript_text !== undefined ? String(row.transcript_text) : null,
  transcriptSource: row.transcript_source !== null && row.transcript_source !== undefined ? String(row.transcript_source) : null,
  transcriptError: row.transcript_error !== null && row.transcript_error !== undefined ? String(row.transcript_error) : null,
  transcriptAttempts: Number(row.transcript_attempts),
  transcriptStartedAt: row.transcript_started_at !== null && row.transcript_started_at !== undefined ? String(row.transcript_started_at) : null,
  transcriptCompletedAt: row.transcript_completed_at !== null && row.transcript_completed_at !== undefined ? String(row.transcript_completed_at) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export const upsertMemoVoiceNote = async (db: D1Database, input: UpsertMemoVoiceNoteInput): Promise<MemoVoiceNote> => {
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT * FROM memo_voice_notes WHERE memo_id = ? LIMIT 1').bind(input.memoId).first<Record<string, unknown>>();
  const audioChanged =
    existing === null ||
    String(existing.object_key) !== input.objectKey ||
    String(existing.audio_url) !== input.audioUrl ||
    String(existing.mime_type) !== input.mimeType ||
    Number(existing.duration_ms) !== input.durationMs;

  const transcriptStatus =
    input.transcriptStatus !== undefined
      ? input.transcriptStatus
      : audioChanged
        ? 'pending'
        : existing?.transcript_status !== undefined && existing?.transcript_status !== null
        ? (String(existing.transcript_status) as MemoVoiceNote['transcriptStatus'])
        : 'pending';
  const transcriptText =
    input.transcriptText !== undefined
      ? input.transcriptText
      : audioChanged
        ? null
        : existing?.transcript_text !== undefined && existing?.transcript_text !== null
        ? String(existing.transcript_text)
        : null;
  const transcriptSource =
    input.transcriptSource !== undefined
      ? input.transcriptSource
      : audioChanged
        ? null
        : existing?.transcript_source !== undefined && existing?.transcript_source !== null
        ? String(existing.transcript_source)
        : null;
  const transcriptError =
    input.transcriptError !== undefined
      ? input.transcriptError
      : audioChanged
        ? null
        : existing?.transcript_error !== undefined && existing?.transcript_error !== null
        ? String(existing.transcript_error)
        : null;
  const transcriptAttempts =
    input.transcriptAttempts !== undefined
      ? input.transcriptAttempts
      : audioChanged
        ? 0
        : existing?.transcript_attempts !== undefined && existing?.transcript_attempts !== null
        ? Number(existing.transcript_attempts)
        : 0;
  const transcriptStartedAt =
    input.transcriptStartedAt !== undefined
      ? input.transcriptStartedAt
      : audioChanged
        ? null
        : existing?.transcript_started_at !== undefined && existing?.transcript_started_at !== null
        ? String(existing.transcript_started_at)
        : null;
  const transcriptCompletedAt =
    input.transcriptCompletedAt !== undefined
      ? input.transcriptCompletedAt
      : audioChanged
        ? null
        : existing?.transcript_completed_at !== undefined && existing?.transcript_completed_at !== null
        ? String(existing.transcript_completed_at)
        : null;
  const createdAt = existing?.created_at !== undefined && existing?.created_at !== null ? String(existing.created_at) : now;

  const row = await db
    .prepare(
      `INSERT INTO memo_voice_notes (
         memo_id,
         object_key,
         audio_url,
         mime_type,
         duration_ms,
         transcript_status,
         transcript_text,
         transcript_source,
         transcript_error,
         transcript_attempts,
         transcript_started_at,
         transcript_completed_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(memo_id) DO UPDATE SET
         object_key = excluded.object_key,
         audio_url = excluded.audio_url,
         mime_type = excluded.mime_type,
         duration_ms = excluded.duration_ms,
         transcript_status = excluded.transcript_status,
         transcript_text = excluded.transcript_text,
         transcript_source = excluded.transcript_source,
         transcript_error = excluded.transcript_error,
         transcript_attempts = excluded.transcript_attempts,
         transcript_started_at = excluded.transcript_started_at,
         transcript_completed_at = excluded.transcript_completed_at,
         updated_at = excluded.updated_at
       RETURNING *`,
    )
    .bind(
      input.memoId,
      input.objectKey,
      input.audioUrl,
      input.mimeType,
      input.durationMs,
      transcriptStatus,
      transcriptText,
      transcriptSource,
      transcriptError,
      transcriptAttempts,
      transcriptStartedAt,
      transcriptCompletedAt,
      createdAt,
      now,
    )
    .first<Record<string, unknown>>();

  if (!row) {
    throw new Error('Failed to upsert memo voice note');
  }

  return mapVoiceNoteRow(row);
};

export const getMemoVoiceNoteByMemoId = async (db: D1Database, memoId: number): Promise<MemoVoiceNote | null> => {
  const row = await db.prepare('SELECT * FROM memo_voice_notes WHERE memo_id = ? LIMIT 1').bind(memoId).first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  return mapVoiceNoteRow(row);
};

export const listMemoVoiceNotesByStatuses = async (
  db: D1Database,
  statuses: MemoVoiceNote['transcriptStatus'][],
  limit = 20,
): Promise<MemoVoiceNote[]> => {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT * FROM memo_voice_notes WHERE transcript_status IN (${placeholders}) ORDER BY updated_at ASC LIMIT ?`)
    .bind(...statuses, limit)
    .all();

  return (results ?? []).map((row) => mapVoiceNoteRow(row as Record<string, unknown>));
};

export const updateMemoVoiceNoteTranscript = async (
  db: D1Database,
  memoId: number,
  input: {
    transcriptStatus: MemoVoiceNote['transcriptStatus'];
    transcriptText?: string | null;
    transcriptSource?: string | null;
    transcriptError?: string | null;
    transcriptAttempts?: number;
    transcriptStartedAt?: string | null;
    transcriptCompletedAt?: string | null;
  },
): Promise<MemoVoiceNote | null> => {
  const existing = await getMemoVoiceNoteByMemoId(db, memoId);
  if (!existing) return null;

  return upsertMemoVoiceNote(db, {
    memoId,
    objectKey: existing.objectKey,
    audioUrl: existing.audioUrl,
    mimeType: existing.mimeType,
    durationMs: existing.durationMs,
    transcriptStatus: input.transcriptStatus,
    transcriptText: input.transcriptText ?? existing.transcriptText,
    transcriptSource: input.transcriptSource ?? existing.transcriptSource,
    transcriptError: input.transcriptError ?? existing.transcriptError,
    transcriptAttempts: input.transcriptAttempts ?? existing.transcriptAttempts,
    transcriptStartedAt: input.transcriptStartedAt ?? existing.transcriptStartedAt,
    transcriptCompletedAt: input.transcriptCompletedAt ?? existing.transcriptCompletedAt,
  });
};

export const attachMemoVoiceNotes = async (db: D1Database, memos: MemoSummary[]): Promise<MemoSummary[]> => {
  if (memos.length === 0) {
    return memos;
  }

  const ids = memos.map((memo) => memo.id);
  const voiceNotesByMemo = new Map<number, MemoVoiceNote>();

  const CHUNK = 99;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM memo_voice_notes WHERE memo_id IN (${placeholders}) ORDER BY memo_id ASC`)
      .bind(...chunk)
      .all();

    for (const row of results ?? []) {
      const voiceNote = mapVoiceNoteRow(row as Record<string, unknown>);
      voiceNotesByMemo.set(voiceNote.memoId, voiceNote);
    }
  }

  return memos.map((memo) => {
    const voiceNote = voiceNotesByMemo.get(memo.id);
    return voiceNote ? { ...memo, voiceNote } : memo;
  });
};
