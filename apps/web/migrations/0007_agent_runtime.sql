CREATE TABLE agent_station (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_id TEXT NOT NULL REFERENCES agent_tokens(id),
  station_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  generation TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE agent_commands (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  status TEXT NOT NULL DEFAULT 'queued',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE agent_contexts (
  tab_id TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE agent_events (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at INTEGER NOT NULL
);
CREATE TABLE agent_proposals (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data)),
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE agent_receipts (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  command_id TEXT NOT NULL REFERENCES agent_commands(id),
  response TEXT CHECK (response IS NULL OR json_valid(response))
);
CREATE TABLE agent_write_fence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  valid INTEGER NOT NULL CHECK (valid = 1)
);
CREATE INDEX agent_commands_status ON agent_commands(status, created_at);
CREATE INDEX agent_events_type ON agent_events(type, created_at);
