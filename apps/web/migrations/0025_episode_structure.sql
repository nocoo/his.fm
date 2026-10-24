ALTER TABLE episodes ADD COLUMN lead TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN research_note TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN credits TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN body TEXT NOT NULL DEFAULT '';

CREATE TABLE episode_topics (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  source_urls TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_urls)),
  PRIMARY KEY (episode_id, position)
);

CREATE INDEX episode_topics_episode ON episode_topics(episode_id, position);

CREATE TABLE episode_mentions (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  url TEXT CHECK (url IS NULL OR (length(url) <= 2048 AND url LIKE 'http%')),
  PRIMARY KEY (episode_id, position)
);

CREATE INDEX episode_mentions_episode ON episode_mentions(episode_id, position);
