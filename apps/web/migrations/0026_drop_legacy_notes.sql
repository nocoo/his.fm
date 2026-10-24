CREATE TABLE episode_topics_0026 AS SELECT * FROM episode_topics;
CREATE TABLE episode_mentions_0026 AS SELECT * FROM episode_mentions;

CREATE TABLE episodes_0026 (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  transcript TEXT NOT NULL,
  lead TEXT NOT NULL DEFAULT '',
  research_note TEXT NOT NULL DEFAULT '',
  credits TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  audio_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_production_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  write_id TEXT NOT NULL DEFAULT '',
  seo TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(seo)),
  rss_guid TEXT,
  CHECK (status != 'published' OR published_at IS NOT NULL),
  UNIQUE (category, slug)
);

INSERT INTO episodes_0026 (
  id, slug, episode_number, title, summary, transcript, lead, research_note, credits, body,
  cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at,
  created_at, updated_at, source_production_id, version, write_id, seo, rss_guid
)
SELECT
  id, slug, episode_number, title, summary, transcript, lead, research_note, credits, body,
  cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at,
  created_at, updated_at, source_production_id, version, write_id, seo, rss_guid
FROM episodes;

DROP TABLE episodes;

ALTER TABLE episodes_0026 RENAME TO episodes;

CREATE INDEX episodes_public ON episodes(status, published_at DESC);
CREATE UNIQUE INDEX episodes_production ON episodes(source_production_id);
CREATE UNIQUE INDEX episodes_category_number ON episodes(category, episode_number);

INSERT INTO episode_topics (episode_id, position, title, detail, source_urls)
SELECT episode_id, position, title, detail, source_urls FROM episode_topics_0026;

INSERT INTO episode_mentions (episode_id, position, name, description, url)
SELECT episode_id, position, name, description, url FROM episode_mentions_0026;

DROP TABLE episode_topics_0026;
DROP TABLE episode_mentions_0026;
