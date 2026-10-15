ALTER TABLE agent_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes));
ALTER TABLE agent_tokens ADD COLUMN parent_id TEXT REFERENCES agent_tokens(id);
UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
