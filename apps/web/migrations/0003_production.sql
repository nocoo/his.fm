CREATE TABLE productions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  stage TEXT NOT NULL CHECK (stage IN ('draft', 'brief_review', 'scripting', 'script_review', 'production', 'final_review', 'ready')),
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX productions_updated ON productions(updated_at DESC);
CREATE TABLE agent_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE production_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL CHECK (json_valid(data))
);
ALTER TABLE episodes ADD COLUMN source_production_id TEXT;
CREATE UNIQUE INDEX episodes_production ON episodes(source_production_id);
