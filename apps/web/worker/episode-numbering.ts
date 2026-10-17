import { HttpError } from './http';

type ExcludeIds = { productionId?: string; episodeId?: string };
type HolderKind = 'episode' | 'production';

function isUniqueConflict(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

async function maxClaimedNumber(db: D1Database, category: string): Promise<number> {
  const row = await db
    .prepare('SELECT MAX(episode_number) AS max_num FROM episode_number_claims WHERE category = ?')
    .bind(category)
    .first<{ max_num: number | null }>();
  return row?.max_num ?? 0;
}

async function episodeNumberTaken(
  db: D1Database,
  category: string,
  episodeNumber: number,
  exclude: ExcludeIds,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT holder_id FROM episode_number_claims WHERE category = ? AND episode_number = ?')
    .bind(category, episodeNumber)
    .first<{ holder_id: string }>();
  if (!row) return false;
  if (exclude.productionId && row.holder_id === exclude.productionId) return false;
  if (exclude.episodeId && row.holder_id === exclude.episodeId) return false;
  return true;
}

export function insertEpisodeNumberClaim(
  db: D1Database,
  category: string,
  episodeNumber: number,
  holderId: string,
  holderKind: HolderKind,
) {
  return db
    .prepare(
      'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
    )
    .bind(category, episodeNumber, holderId, holderKind);
}

export function updateEpisodeNumberClaim(
  db: D1Database,
  holderId: string,
  category: string,
  episodeNumber: number,
) {
  return db
    .prepare('UPDATE episode_number_claims SET category = ?, episode_number = ? WHERE holder_id = ?')
    .bind(category, episodeNumber, holderId);
}

export function deleteEpisodeNumberClaim(db: D1Database, holderId: string) {
  return db.prepare('DELETE FROM episode_number_claims WHERE holder_id = ?').bind(holderId);
}

export async function nextEpisodeNumberInCategory(
  db: D1Database,
  category: string,
  exclude: ExcludeIds = {},
): Promise<number> {
  let next = (await maxClaimedNumber(db, category)) + 1;
  while (await episodeNumberTaken(db, category, next, exclude)) next += 1;
  return next;
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

export async function reserveEpisodeNumberClaim(
  db: D1Database,
  category: string,
  holderId: string,
  holderKind: HolderKind,
  explicit?: number,
  exclude: ExcludeIds = {},
): Promise<number> {
  const maxAttempts = explicit === undefined ? 16 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const episodeNumber =
      explicit === undefined ? await nextEpisodeNumberInCategory(db, category, exclude) : explicit;
    if (explicit !== undefined) await assertEpisodeNumberAvailable(db, category, episodeNumber, exclude);
    try {
      await insertEpisodeNumberClaim(db, category, episodeNumber, holderId, holderKind).run();
      return episodeNumber;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      if (explicit !== undefined) throw new HttpError(409, '该栏目下已有相同期数');
    }
  }
  /* v8 ignore next */
  throw new HttpError(503, '栏目期数暂时无法分配，请稍后重试');
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

export async function batchInsertWithEpisodeNumberClaim<T>(
  db: D1Database,
  category: string,
  holderId: string,
  insertRow: (episodeNumber: number) => D1PreparedStatement,
  explicitEpisodeNumber?: number,
): Promise<T> {
  const maxAttempts = explicitEpisodeNumber === undefined ? 16 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const episodeNumber =
      explicitEpisodeNumber ?? (await nextEpisodeNumberInCategory(db, category, { episodeId: holderId }));
    if (explicitEpisodeNumber !== undefined) {
      await assertEpisodeNumberAvailable(db, category, episodeNumber, { episodeId: holderId });
    }
    try {
      const results = await db.batch([
        insertEpisodeNumberClaim(db, category, episodeNumber, holderId, 'episode'),
        insertRow(episodeNumber),
      ]);
      const row = results[1].results?.[0] as T | undefined;
      if (!row) throw new HttpError(503, '节目暂时无法创建，请重试');
      return row;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const unique = /UNIQUE constraint failed/.test(message);
      if (explicitEpisodeNumber !== undefined) {
        if (unique) throw new HttpError(409, '该栏目下已有相同期数或链接名称');
        throw error;
      }
      if (!unique) throw error;
      if (/episodes\.category/.test(message)) throw new HttpError(409, '该栏目下已有相同期数或链接名称');
    }
  }
  /* v8 ignore next */
  throw new HttpError(503, '栏目期数暂时无法分配，请稍后重试');
}
