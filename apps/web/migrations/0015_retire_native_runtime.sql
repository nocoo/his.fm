UPDATE agent_tokens
SET scopes = COALESCE((
  SELECT json_group_array(json(CASE type
    WHEN 'text' THEN json_quote(value)
    WHEN 'null' THEN 'null'
    WHEN 'true' THEN 'true'
    WHEN 'false' THEN 'false'
    ELSE value
  END)) FROM json_each(agent_tokens.scopes)
  WHERE type != 'text' OR value NOT IN (
    'settings:read', 'settings:write', 'credentials:write', 'audio:generate',
    'tasks:read', 'tasks:submit', 'tasks:cancel', 'tasks:manage',
    'runtime:connect', 'runtime:manage'
  )
), '[]')
WHERE json_type(scopes) = 'array'
  AND json_array_length(scopes) <= 40
  AND NOT EXISTS (
    SELECT 1 FROM json_each(agent_tokens.scopes)
    WHERE type = 'text' GROUP BY value HAVING COUNT(*) > 1
  );

CREATE TABLE media_provenance (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data))
);

INSERT INTO media_provenance (id, data)
SELECT 'production:' || id,
  json_object('productionId', id, 'jobId', json_extract(data, '$.audioJob.id'),
    'scriptVersion', json_extract(data, '$.audioJob.scriptVersion'),
    'status', json_extract(data, '$.audioJob.status'),
    'createdAt', json_extract(data, '$.audioJob.createdAt'))
FROM productions WHERE json_extract(data, '$.audioJob.id') IS NOT NULL;

INSERT INTO media_provenance (id, data)
SELECT 'audio:' || id,
  json_object('productionId', production_id, 'scriptVersion', json_extract(snapshot, '$.scriptVersion'),
    'voice', json_extract(snapshot, '$.voice'), 'status', status, 'createdAt', created_at,
    'references', json(COALESCE((
      SELECT json_group_array(json_object('key', value)) FROM json_tree(audio_jobs.snapshot)
      WHERE type = 'text' AND key IN ('key', 'introKey', 'outroKey', 'url')
    ), '[]')))
FROM audio_jobs;

INSERT INTO media_provenance (id, data)
SELECT 'speech:' || id,
  json_object('status', status, 'createdAt', created_at,
    'references', json(COALESCE((
      SELECT json_group_array(json_object('key', value)) FROM json_tree(speech_jobs.result)
      WHERE type = 'text' AND key IN ('key', 'url')
    ), '[]')))
FROM speech_jobs;

INSERT INTO media_provenance (id, data)
SELECT 'settings:' || id,
  json_object('references', json(COALESCE((
    SELECT json_group_array(json_object('key', value)) FROM json_tree(production_settings.data)
    WHERE type = 'text' AND key IN ('key', 'introKey', 'outroKey', 'url')
  ), '[]')))
FROM production_settings;

UPDATE productions SET data = json_remove(data, '$.audioJob');

DROP TABLE speech_jobs;
DROP TABLE audio_jobs;
DROP TABLE production_settings;
DROP TABLE agent_receipts;
DROP TABLE agent_events;
DROP TABLE agent_proposals;
DROP TABLE agent_contexts;
DROP TABLE agent_commands;
DROP TABLE agent_station;
DROP TABLE agent_write_fence;
