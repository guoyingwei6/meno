ALTER TABLE memos ADD COLUMN client_id TEXT;

UPDATE memos
SET excerpt = substr(content, 1, 240) || CASE WHEN length(content) > 240 THEN '…' ELSE '' END
WHERE excerpt = content;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memos_client_id_unique
  ON memos (client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memos_public_feed
  ON memos (visibility, deleted_at, (pinned_at IS NULL), pinned_at DESC, display_date DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_memos_author_feed
  ON memos (deleted_at, (pinned_at IS NULL), pinned_at DESC, display_date DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_memos_favorited_feed
  ON memos (favorited_at, deleted_at, (pinned_at IS NULL), pinned_at DESC, display_date DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_memo_tags_memo_tag
  ON memo_tags (memo_id, tag);
