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

CREATE INDEX IF NOT EXISTS idx_memos_visibility_deleted_at ON memos (visibility, deleted_at);
CREATE INDEX IF NOT EXISTS idx_memos_display_date ON memos (display_date);
CREATE INDEX IF NOT EXISTS idx_memo_tags_tag ON memo_tags (tag);
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
