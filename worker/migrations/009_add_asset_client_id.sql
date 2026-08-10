ALTER TABLE assets ADD COLUMN client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_client_id_unique
  ON assets (client_id)
  WHERE client_id IS NOT NULL;
