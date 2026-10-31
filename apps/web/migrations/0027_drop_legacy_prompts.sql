-- Safe legacy prompt removal: drop columns in place so episodes.category and
-- category_id_aliases keep referencing categories(id) without a table rebuild.
-- defer_foreign_keys documents D1 intent when dropping prompt_slot_backups.
PRAGMA defer_foreign_keys = ON;

ALTER TABLE channel_profile DROP COLUMN content;
ALTER TABLE channel_profile DROP COLUMN prompts;

ALTER TABLE categories DROP COLUMN prompt;

DROP TABLE IF EXISTS prompt_slot_backups;
