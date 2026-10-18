ALTER TABLE channel_profile ADD COLUMN prompt_slots TEXT CHECK (prompt_slots IS NULL OR json_valid(prompt_slots));
ALTER TABLE channel_profile ADD COLUMN prompt_slots_version INTEGER NOT NULL DEFAULT 0 CHECK (prompt_slots_version >= 0);
ALTER TABLE categories ADD COLUMN prompt_slots TEXT CHECK (prompt_slots IS NULL OR json_valid(prompt_slots));
ALTER TABLE categories ADD COLUMN prompt_slots_version INTEGER NOT NULL DEFAULT 0 CHECK (prompt_slots_version >= 0);
CREATE TABLE prompt_slot_backups (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('channel', 'category')),
  resource_id TEXT NOT NULL,
  legacy_version INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
