CREATE TABLE IF NOT EXISTS memo_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id INTEGER NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memo_shares_token ON memo_shares (token);
CREATE INDEX IF NOT EXISTS idx_memo_shares_memo_id ON memo_shares (memo_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
