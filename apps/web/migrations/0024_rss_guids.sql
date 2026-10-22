ALTER TABLE episodes ADD COLUMN rss_guid TEXT;

UPDATE episodes
SET rss_guid = 'https://his.fm/episodes/' || category || '/' || slug;

ALTER TABLE categories ADD COLUMN rss_identity TEXT;

UPDATE categories SET rss_identity = id;
