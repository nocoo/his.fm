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
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug IN (
  'daily-news-2026-10-15',
  'daily-news-2026-10-16',
  'daily-news-2026-10-17'
)
AND (
  title LIKE '%每日新闻%'
  OR summary LIKE '%每日新闻%'
  OR transcript LIKE '%每日新闻%'
  OR show_notes LIKE '%每日新闻%'
  OR tags LIKE '%每日新闻%'
);

UPDATE productions
SET data = REPLACE(data, '每日新闻', '每日手冲'),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  'ded73752-422d-445b-9ac4-5c7230015a49',
  '02b233b5-893d-4944-9fbd-4d16e3af4124',
  '2c5e3878-5320-4e1f-98f0-9c7e3c51012a'
)
AND data LIKE '%每日新闻%';

UPDATE bumpers
SET name = '这里是慢慢学会的每日手冲，我们一起看看今天冲了什么',
    version = version + 1
WHERE position = 'intro'
  AND name = '这里是慢慢学会的每日新闻，我们一起看看今天冲了什么';
