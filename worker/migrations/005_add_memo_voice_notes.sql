PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memo_voice_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id INTEGER NOT NULL UNIQUE REFERENCES memos(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  transcript_status TEXT NOT NULL DEFAULT 'pending' CHECK (transcript_status IN ('pending', 'processing', 'done', 'failed', 'not_available')),
  transcript_text TEXT,
  transcript_source TEXT,
  transcript_error TEXT,
  transcript_attempts INTEGER NOT NULL DEFAULT 0,
  transcript_started_at TEXT,
  transcript_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memo_voice_notes_memo_id ON memo_voice_notes (memo_id);
