import { type ArtRecord, artLocation } from '../src/shared/episode-art';
import type { Production } from '../src/shared/production';
import { getAppearance } from './appearance';
import { HttpError } from './http';

export async function artRecords(
  db: D1Database,
  filter?: { resource: 'episodes' | 'productions'; id?: string; category?: string },
) {
  const records: ArtRecord[] = [];
  if (!filter || filter.resource === 'episodes') {
    const query = db.prepare(
      `SELECT e.id, e.title, e.episode_number AS episodeNumber, e.cover_url AS coverUrl, c.name AS categoryName FROM episodes e JOIN categories c ON c.id = e.category${filter?.id ? ' WHERE e.id = ?' : filter?.category ? ' WHERE e.category = ?' : ''}`,
    );
    const rows = await (filter?.id
      ? query.bind(filter.id)
      : filter?.category
        ? query.bind(filter.category)
        : query
    ).all<Omit<ArtRecord, 'resource'>>();
    if (!rows.success) throw new HttpError(503, '节目图片引用暂时无法读取');
    records.push(...rows.results.map((row) => ({ ...row, resource: 'episodes' as const })));
  }
  if (!filter || filter.resource === 'productions') {
    const query = db.prepare(
      `SELECT p.data, c.name AS categoryName FROM productions p JOIN categories c ON c.id = json_extract(p.data, '$.category')${filter?.id ? ' WHERE p.id = ?' : filter?.category ? " WHERE json_extract(p.data, '$.category') = ?" : ''}`,
    );
    const rows = await (filter?.id
      ? query.bind(filter.id)
      : filter?.category
        ? query.bind(filter.category)
        : query
    ).all<{ data: string; categoryName: string }>();
    if (!rows.success) throw new HttpError(503, '制作图片引用暂时无法读取');
    for (const row of rows.results) {
      const production = JSON.parse(row.data) as Production;
      if (production.assets.cover)
        records.push({
          id: production.id,
          title: production.title,
          episodeNumber: production.episodeNumber,
          coverUrl: production.assets.cover.url,
          categoryName: row.categoryName,
          resource: 'productions',
        });
    }
  }
  return records;
}

export async function currentArtPrefixes(db: D1Database) {
  const [records, { theme }] = await Promise.all([artRecords(db), getAppearance(db)]);
  const locations = await Promise.all(
    records.flatMap((record) => [artLocation(record, theme), artLocation(record, null)]),
  );
  return locations.map(({ prefix }) => prefix);
}
