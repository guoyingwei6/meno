CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(content, slug, memo_id UNINDEXED);

DELETE FROM memos_fts;
INSERT INTO memos_fts (rowid, content, slug, memo_id)
SELECT id, content, slug, id FROM memos;

CREATE TRIGGER IF NOT EXISTS memos_fts_after_insert
AFTER INSERT ON memos
BEGIN
  INSERT INTO memos_fts (rowid, content, slug, memo_id)
  VALUES (new.id, new.content, new.slug, new.id);
END;

CREATE TRIGGER IF NOT EXISTS memos_fts_after_update
AFTER UPDATE OF content, slug ON memos
BEGIN
  DELETE FROM memos_fts WHERE rowid = old.id;
  INSERT INTO memos_fts (rowid, content, slug, memo_id)
  VALUES (new.id, new.content, new.slug, new.id);
END;

CREATE TRIGGER IF NOT EXISTS memos_fts_after_delete
AFTER DELETE ON memos
BEGIN
  DELETE FROM memos_fts WHERE rowid = old.id;
END;
