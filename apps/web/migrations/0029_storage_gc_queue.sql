CREATE TABLE IF NOT EXISTS storage_gc_queue (
  key TEXT PRIMARY KEY,
  first_unreferenced_at TEXT NOT NULL
);
