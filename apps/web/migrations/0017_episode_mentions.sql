ALTER TABLE episodes ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mentions));
