CREATE TABLE audio_jobs (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX audio_jobs_production ON audio_jobs(production_id, created_at DESC);
