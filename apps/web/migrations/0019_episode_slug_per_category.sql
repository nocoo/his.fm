PRAGMA foreign_keys = OFF;

CREATE TABLE episodes_next (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  transcript TEXT NOT NULL,
  show_notes TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  mentions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mentions)),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  audio_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_production_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (status != 'published' OR published_at IS NOT NULL),
  UNIQUE (category, slug)
);

INSERT INTO episodes_next (
  id,
  slug,
  episode_number,
  title,
  summary,
  transcript,
  show_notes,
  cover_url,
  category,
  tags,
  mentions,
  duration_seconds,
  audio_url,
  status,
  featured,
  published_at,
  created_at,
  updated_at,
  source_production_id,
  version
)
SELECT
  id,
  slug,
  episode_number,
  title,
  summary,
  transcript,
  show_notes,
  cover_url,
  category,
  tags,
  mentions,
  duration_seconds,
  audio_url,
  status,
  featured,
  published_at,
  created_at,
  updated_at,
  source_production_id,
  version
FROM episodes;

DROP TABLE episodes;

ALTER TABLE episodes_next RENAME TO episodes;

CREATE INDEX episodes_public ON episodes(status, published_at DESC);

CREATE UNIQUE INDEX episodes_production ON episodes(source_production_id);

CREATE UNIQUE INDEX episodes_category_number ON episodes(category, episode_number);

PRAGMA foreign_keys = ON;
