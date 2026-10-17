ALTER TABLE productions ADD COLUMN write_id TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN write_id TEXT NOT NULL DEFAULT '';
UPDATE productions SET write_id = lower(hex(randomblob(16))) WHERE write_id = '';
UPDATE episodes SET write_id = lower(hex(randomblob(16))) WHERE write_id = '';
