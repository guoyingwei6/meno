ALTER TABLE memo_shares ADD COLUMN expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_memo_shares_expires_at ON memo_shares (expires_at);
