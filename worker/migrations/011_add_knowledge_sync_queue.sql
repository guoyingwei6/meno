CREATE TABLE IF NOT EXISTS knowledge_sync_queue (
  memo_id INTEGER PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  next_retry_at TEXT NOT NULL,
  processing_token TEXT,
  processing_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sync_queue_due
  ON knowledge_sync_queue (next_retry_at, processing_until, updated_at);
