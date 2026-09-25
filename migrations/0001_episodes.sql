CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  transcript TEXT NOT NULL,
  show_notes TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('work', 'learning', 'life', 'conversations')),
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  audio_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status != 'published' OR published_at IS NOT NULL)
);

CREATE INDEX episodes_public ON episodes(status, published_at DESC);

CREATE TABLE local_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE local_seed_runs (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
