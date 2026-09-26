CREATE TABLE site_appearance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  theme TEXT NOT NULL CHECK (theme IN (
    'grove', 'interval', 'soft-landing', 'human-sample',
    'stillwood', 'tidal-hours', 'window-seat', 'alpine-bloom'
  )),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO site_appearance (id, version, theme, updated_at, updated_by)
VALUES (1, 1, 'interval', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'his.fm');
