CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
INSERT INTO categories (id, name, icon, color, updated_at, updated_by) VALUES
  ('manager-notes', '主理人手札', 'briefcase-business', 'blue', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'his.fm'),
  ('learning', '每日手冲', 'book-open', 'teal', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'his.fm'),
  ('life', '生活留白', 'leaf', 'amber', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'his.fm'),
  ('conversations', '一起聊聊', 'messages-square', 'rose', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'his.fm');

CREATE TABLE episodes_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  transcript TEXT NOT NULL,
  show_notes TEXT NOT NULL,
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
  CHECK (status != 'published' OR published_at IS NOT NULL)
);
INSERT INTO episodes_categories SELECT * FROM episodes;
DROP TABLE episodes;
ALTER TABLE episodes_categories RENAME TO episodes;
CREATE INDEX episodes_public ON episodes(status, published_at DESC);
CREATE UNIQUE INDEX episodes_production ON episodes(source_production_id);

CREATE TABLE category_write_fence (id INTEGER PRIMARY KEY CHECK (id=1), valid INTEGER NOT NULL CHECK (valid=1));
