export const IMPORT_EXAMPLE_MARKER = 'hisfm-real-production-example-v1';

export const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** @param {Record<string, unknown>} production parsed production payload (episodeNumber set in SQL) */
export function buildImportExampleStatements(production, { mode, now, importWriteId }) {
  const localGuard =
    mode === '--local'
      ? ` AND NOT EXISTS (SELECT 1 FROM local_seed_runs WHERE name = ${quote(IMPORT_EXAMPLE_MARKER)})`
      : '';
  const productionGuard = `NOT EXISTS (SELECT 1 FROM productions WHERE json_extract(data, '$.slug') = ${quote(production.slug)})${localGuard}`;
  const productionData = quote(JSON.stringify(production));
  const writeId = quote(importWriteId);
  const statements = [
    `INSERT INTO productions (id, version, stage, data, created_at, updated_at, write_id)
     SELECT ${quote(production.id)}, 1, 'draft', json_set(${productionData}, '$.episodeNumber', (
       SELECT COALESCE(MAX(episode_number), 0) + 1 FROM episode_number_claims WHERE category = ${quote(production.category)}
     )), ${quote(now)}, ${quote(now)}, ${writeId}
     WHERE ${productionGuard}`,
    `INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind)
     SELECT json_extract(data, '$.category'), CAST(json_extract(data, '$.episodeNumber') AS INTEGER), id, 'production'
     FROM productions
     WHERE write_id = ${writeId}
     AND NOT EXISTS (
       SELECT 1 FROM episode_number_claims existing
       WHERE existing.holder_kind = 'production' AND existing.holder_id = productions.id
     )`,
  ];
  if (mode === '--local') {
    statements.push(
      `INSERT OR IGNORE INTO local_seed_runs (name, created_at) VALUES (${quote(IMPORT_EXAMPLE_MARKER)}, ${quote(now)});`,
    );
  }
  return statements;
}
