CREATE TABLE channel_profile_0027 (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  prompt_slots TEXT CHECK (prompt_slots IS NULL OR json_valid(prompt_slots)),
  prompt_slots_version INTEGER NOT NULL DEFAULT 0 CHECK (prompt_slots_version >= 0)
);

INSERT INTO channel_profile_0027 (id, version, updated_at, updated_by, prompt_slots, prompt_slots_version)
SELECT id, version, updated_at, updated_by, prompt_slots, prompt_slots_version FROM channel_profile;

DROP TABLE channel_profile;

ALTER TABLE channel_profile_0027 RENAME TO channel_profile;

CREATE TABLE categories_0027 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  seo TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(seo)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  prompt_slots TEXT CHECK (prompt_slots IS NULL OR json_valid(prompt_slots)),
  prompt_slots_version INTEGER NOT NULL DEFAULT 0 CHECK (prompt_slots_version >= 0),
  rss_identity TEXT
);

INSERT INTO categories_0027 (
  id, name, icon, color, seo, version, updated_at, updated_by, prompt_slots, prompt_slots_version, rss_identity
)
SELECT id, name, icon, color, seo, version, updated_at, updated_by, prompt_slots, prompt_slots_version, rss_identity
FROM categories;

DROP TABLE categories;

ALTER TABLE categories_0027 RENAME TO categories;

DROP TABLE prompt_slot_backups;
