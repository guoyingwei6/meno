export const schemaSql = `
CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL,
  display_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  deleted_at TEXT,
  pinned_at TEXT,
  favorited_at TEXT,
  previous_visibility TEXT,
  excerpt TEXT NOT NULL,
  has_images INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  tag_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS memo_tags (
  memo_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  UNIQUE(memo_id, tag)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  original_url TEXT NOT NULL,
  preview_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  created_at TEXT NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_memos_visibility_deleted_at ON memos (visibility, deleted_at);
CREATE INDEX IF NOT EXISTS idx_memos_display_date ON memos (display_date);
CREATE INDEX IF NOT EXISTS idx_memo_tags_tag ON memo_tags (tag);
CREATE INDEX IF NOT EXISTS idx_memo_image_ocr_status_retry ON memo_image_ocr (status, next_retry_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_memo_image_ocr_memo_id ON memo_image_ocr (memo_id);
`;

export const applySchema = (db: D1Database) => {
  const statements = schemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    db.exec(`${statement};`);
  }
};
