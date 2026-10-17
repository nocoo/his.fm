import { HttpError } from './http';

type ExcludeIds = { productionId?: string; episodeId?: string };

async function maxEpisodeNumberInCategory(db: D1Database, category: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT MAX(num) AS max_num FROM (
        SELECT episode_number AS num FROM episodes WHERE category = ?
        UNION ALL
        SELECT CAST(json_extract(data, '$.episodeNumber') AS INTEGER) AS num
        FROM productions WHERE json_extract(data, '$.category') = ?
      )`,
    )
    .bind(category, category)
    .first<{ max_num: number | null }>();
  return row?.max_num ?? 0;
}

export async function nextEpisodeNumberInCategory(
  db: D1Database,
  category: string,
  exclude: ExcludeIds = {},
): Promise<number> {
  let next = (await maxEpisodeNumberInCategory(db, category)) + 1;
  while (await episodeNumberTaken(db, category, next, exclude)) next += 1;
  return next;
}

async function episodeNumberTaken(
  db: D1Database,
  category: string,
  episodeNumber: number,
  exclude: ExcludeIds,
): Promise<boolean> {
  let episodeSql = 'SELECT id FROM episodes WHERE category = ? AND episode_number = ?';
  const episodeBinds: (string | number)[] = [category, episodeNumber];
  if (exclude.episodeId) {
    episodeSql += ' AND id != ?';
    episodeBinds.push(exclude.episodeId);
  }
  if (exclude.productionId) {
    episodeSql += ' AND (source_production_id IS NULL OR source_production_id != ?)';
    episodeBinds.push(exclude.productionId);
  }
  if (
    await db
      .prepare(episodeSql)
      .bind(...episodeBinds)
      .first()
  )
    return true;

  let productionSql =
    "SELECT id FROM productions WHERE json_extract(data, '$.category') = ? AND CAST(json_extract(data, '$.episodeNumber') AS INTEGER) = ?";
  const productionBinds: (string | number)[] = [category, episodeNumber];
  if (exclude.productionId) {
    productionSql += ' AND id != ?';
    productionBinds.push(exclude.productionId);
  }
  return Boolean(
    await db
      .prepare(productionSql)
      .bind(...productionBinds)
      .first(),
  );
}

export async function assertEpisodeNumberAvailable(
  db: D1Database,
  category: string,
  episodeNumber: number,
  exclude: ExcludeIds = {},
): Promise<void> {
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1)
    throw new HttpError(400, '期数必须是大于 0 的整数');
  if (await episodeNumberTaken(db, category, episodeNumber, exclude))
    throw new HttpError(409, '该栏目下已有相同期数');
}

export async function resolveEpisodeNumberForCreate(
  db: D1Database,
  category: string,
  explicit?: number,
  exclude: ExcludeIds = {},
): Promise<number> {
  if (explicit !== undefined) {
    await assertEpisodeNumberAvailable(db, category, explicit, exclude);
    return explicit;
  }
  return nextEpisodeNumberInCategory(db, category, exclude);
}

export async function resolveScopedEpisodeNumber(
  db: D1Database,
  current: { id: string; category: string; episodeNumber: number },
  fields: { category?: string; episodeNumber?: number },
  exclude: ExcludeIds,
): Promise<number> {
  const category = fields.category ?? current.category;
  const categoryChanged = fields.category !== undefined && fields.category !== current.category;
  if (fields.episodeNumber !== undefined) {
    await assertEpisodeNumberAvailable(db, category, fields.episodeNumber, exclude);
    return fields.episodeNumber;
  }
  if (categoryChanged) return nextEpisodeNumberInCategory(db, category, exclude);
  return current.episodeNumber;
}

export async function resolveProductionPatchEpisodeNumber(
  db: D1Database,
  current: { id: string; category: string; episodeNumber: number },
  fields: { category?: string; episodeNumber?: number },
): Promise<number> {
  return resolveScopedEpisodeNumber(db, current, fields, { productionId: current.id });
}

export async function resolveEpisodePatchEpisodeNumber(
  db: D1Database,
  current: { id: string; category: string; episodeNumber: number },
  fields: { category?: string; episodeNumber?: number },
): Promise<number> {
  return resolveScopedEpisodeNumber(db, current, fields, { episodeId: current.id });
}
