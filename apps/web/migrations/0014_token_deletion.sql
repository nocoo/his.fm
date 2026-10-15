ALTER TABLE agent_tokens ADD COLUMN deleted_at TEXT CHECK (deleted_at IS NULL OR revoked_at IS NOT NULL);
