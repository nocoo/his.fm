UPDATE productions
SET data = json_set(data, '$.sources', json(COALESCE((
  SELECT json_group_array(json(CASE
    WHEN json_extract(value, '$.id') IS NULL
    THEN json_set(value, '$.id', 'source-' || lower(hex(randomblob(16))))
    ELSE value END))
  FROM json_each(productions.data, '$.sources')
), '[]')));
