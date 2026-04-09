CREATE TABLE IF NOT EXISTS memo_image_ocr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ocr_text TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(memo_id, image_url)
);

CREATE INDEX IF NOT EXISTS idx_memo_image_ocr_status_retry ON memo_image_ocr (status, next_retry_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_memo_image_ocr_memo_id ON memo_image_ocr (memo_id);
