WITH combined AS (
  SELECT
    e.id AS episode_id,
    NULL AS production_id,
    e.category,
    COALESCE(NULLIF(e.published_at, ''), e.created_at) AS sort_key,
    e.created_at,
    e.id AS tie
  FROM episodes e
  UNION ALL
  SELECT
    NULL,
    p.id,
    json_extract(p.data, '$.category'),
    p.created_at,
    p.created_at,
    p.id
  FROM productions p
  WHERE NOT EXISTS (
    SELECT 1
    FROM episodes e
    WHERE e.source_production_id = p.id
      AND e.category = json_extract(p.data, '$.category')
  )
),
ranked AS (
  SELECT
    episode_id,
    production_id,
    category,
    ROW_NUMBER() OVER (PARTITION BY category ORDER BY sort_key, tie) AS next_number
  FROM combined
)
UPDATE episodes
SET episode_number = (
  SELECT next_number FROM ranked WHERE ranked.episode_id = episodes.id
);

UPDATE productions
SET data = json_set(
  data,
  '$.episodeNumber',
  (
    SELECT episode_number
    FROM episodes
    WHERE source_production_id = productions.id
      AND episodes.category = json_extract(productions.data, '$.category')
    LIMIT 1
  )
)
WHERE EXISTS (
  SELECT 1
  FROM episodes
  WHERE source_production_id = productions.id
    AND episodes.category = json_extract(productions.data, '$.category')
);

WITH combined AS (
  SELECT
    e.id AS episode_id,
    NULL AS production_id,
    e.category,
    COALESCE(NULLIF(e.published_at, ''), e.created_at) AS sort_key,
    e.created_at,
    e.id AS tie
  FROM episodes e
  UNION ALL
  SELECT
    NULL,
    p.id,
    json_extract(p.data, '$.category'),
    p.created_at,
    p.created_at,
    p.id
  FROM productions p
  WHERE NOT EXISTS (
    SELECT 1
    FROM episodes e
    WHERE e.source_production_id = p.id
      AND e.category = json_extract(p.data, '$.category')
  )
),
ranked AS (
  SELECT
    episode_id,
    production_id,
    category,
    ROW_NUMBER() OVER (PARTITION BY category ORDER BY sort_key, tie) AS next_number
  FROM combined
)
UPDATE productions
SET data = json_set(
  data,
  '$.episodeNumber',
  (SELECT next_number FROM ranked WHERE ranked.production_id = productions.id)
)
WHERE EXISTS (
  SELECT 1 FROM ranked WHERE ranked.production_id = productions.id
);

CREATE UNIQUE INDEX IF NOT EXISTS episodes_category_number ON episodes(category, episode_number);

CREATE UNIQUE INDEX IF NOT EXISTS productions_category_episode_number ON productions(
  json_extract(data, '$.category'),
  CAST(json_extract(data, '$.episodeNumber') AS INTEGER)
);
