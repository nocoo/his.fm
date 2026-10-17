CREATE TABLE site_seo (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL CHECK (json_valid(data)),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO site_seo (id, data, version, updated_at, updated_by)
VALUES (1, '{}', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'his.fm');

ALTER TABLE categories ADD COLUMN seo TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(seo));

ALTER TABLE episodes ADD COLUMN seo TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(seo));
