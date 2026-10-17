WITH ranked_episodes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY category
      ORDER BY COALESCE(NULLIF(published_at, ''), created_at), created_at, id
    ) AS next_number
  FROM episodes
)
UPDATE episodes
SET episode_number = (
  SELECT next_number FROM ranked_episodes WHERE ranked_episodes.id = episodes.id
);

WITH ranked_productions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY json_extract(data, '$.category')
      ORDER BY created_at, id
    ) AS next_number
  FROM productions
)
UPDATE productions
SET data = json_set(
  data,
  '$.episodeNumber',
  (SELECT next_number FROM ranked_productions WHERE ranked_productions.id = productions.id)
);

CREATE UNIQUE INDEX episodes_category_number ON episodes(category, episode_number);
