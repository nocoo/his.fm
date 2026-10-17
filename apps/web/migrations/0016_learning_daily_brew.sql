UPDATE categories
SET name = '店长手札',
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'his.fm'
WHERE id = 'work'
  AND name != '店长手札';

UPDATE categories
SET name = '每日手冲',
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'his.fm'
WHERE id = 'learning'
  AND name != '每日手冲';

UPDATE episodes
SET title = REPLACE(title, '每日新闻', '每日手冲'),
    summary = REPLACE(summary, '每日新闻', '每日手冲'),
    transcript = REPLACE(transcript, '每日新闻', '每日手冲'),
    show_notes = REPLACE(show_notes, '每日新闻', '每日手冲'),
    tags = REPLACE(tags, '每日新闻', '每日手冲'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug IN (
  'daily-news-2026-10-15',
  'daily-news-2026-10-16',
  'daily-news-2026-10-17'
);

UPDATE productions
SET data = REPLACE(data, '每日新闻', '每日手冲')
WHERE data LIKE '%每日新闻%';

UPDATE bumpers
SET name = '这里是慢慢学会的每日手冲，我们一起看看今天冲了什么',
    version = version + 1
WHERE position = 'intro'
  AND name != '这里是慢慢学会的每日手冲，我们一起看看今天冲了什么'
  AND (
    name LIKE '%每日新闻%'
    OR name LIKE '%新闻%'
    OR name LIKE '%慢慢学会%'
  );
