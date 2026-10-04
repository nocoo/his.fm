CREATE TABLE speech_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'production')),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  command_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  generation TEXT,
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  created_at TEXT NOT NULL
);
CREATE TABLE bumpers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('intro', 'outro')),
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL CHECK (json_valid(data))
);
