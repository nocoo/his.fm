CREATE TABLE category_id_aliases (
  alias TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);
