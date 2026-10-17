CREATE TABLE episode_number_claims (
  category TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  holder_id TEXT NOT NULL,
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('episode', 'production')),
  PRIMARY KEY (holder_kind, holder_id, category),
  UNIQUE(category, episode_number)
);

INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind)
SELECT category, episode_number, id, 'episode'
FROM episodes;

INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind)
SELECT
  json_extract(data, '$.category'),
  CAST(json_extract(data, '$.episodeNumber') AS INTEGER),
  id,
  'production'
FROM productions
WHERE json_extract(data, '$.episodeNumber') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM episode_number_claims
    WHERE category = json_extract(productions.data, '$.category')
      AND episode_number = CAST(json_extract(productions.data, '$.episodeNumber') AS INTEGER)
  );
