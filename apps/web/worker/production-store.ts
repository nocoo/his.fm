import { hasScope } from '@his-fm/contracts';
import type { Actor, Production } from '../src/shared/production';
import { categoryFence, getCategory } from './categories';
import {
  productionClaimReleaseStatement,
  productionClaimReplaceStatements,
  publishedSnapshotMatchesProduction,
} from './episode-numbering';
import { HttpError } from './http';

export function mediaUrl(env: Pick<Env, 'ENVIRONMENT'>, key: string) {
  return `${env.ENVIRONMENT === 'local' ? '/media' : 'https://f.no.mt'}/${key}`;
}

export function hydrateProduction(production: Production): Production {
  return { ...production, mentions: production.mentions ?? [] };
}

export function projectProduction(
  production: Production,
  actor: Actor,
): Production | Pick<Production, 'id' | 'version'> {
  if (!hasScope(actor, 'productions:read')) return { id: production.id, version: production.version };
  if (hasScope(actor, 'publications:read')) return production;
  return {
    ...production,
    publications: [],
    events: production.events.filter((event) => !event.action.includes('publication:')),
  };
}

export async function getProduction(db: D1Database, id: string): Promise<Production> {
  const row = await db
    .prepare('SELECT data FROM productions WHERE id = ?')
    .bind(id)
    .first<{ data: string }>();
  if (!row) throw new HttpError(404, '制作任务不存在');
  return hydrateProduction(JSON.parse(row.data) as Production);
}

export function appendEvent(production: Production, actor: Actor, action: string, feedback = ''): Production {
  if (production.events.length >= 200)
    throw new HttpError(409, '本任务已有 200 条历史记录，请新建任务继续制作');
  return {
    ...production,
    events: [
      ...production.events,
      { id: crypto.randomUUID(), at: new Date().toISOString(), actor, action, feedback },
    ],
  };
}

export function nextVersion(production: Production, expectedVersion: number): Production {
  if (production.version !== expectedVersion) throw new HttpError(409, '内容已更新，请刷新后重试');
  return { ...production, version: expectedVersion + 1, updatedAt: new Date().toISOString() };
}

export function updateStatement(
  db: D1Database,
  production: Production,
  expectedVersion: number,
  writeId: string,
) {
  return db
    .prepare(
      'UPDATE productions SET version = ?, stage = ?, data = ?, updated_at = ?, write_id = ? WHERE id = ? AND version = ?',
    )
    .bind(
      production.version,
      production.stage,
      JSON.stringify(production),
      production.updatedAt,
      writeId,
      production.id,
      expectedVersion,
    );
}

export async function saveProduction(db: D1Database, production: Production, expectedVersion: number) {
  await getCategory(db, production.category);
  const current = await getProduction(db, production.id);
  const next = nextVersion(production, expectedVersion);
  const numberingChanged = current.category !== next.category || current.episodeNumber !== next.episodeNumber;
  const snapshotOwnsNumber =
    numberingChanged &&
    (await publishedSnapshotMatchesProduction(db, next.id, next.category, next.episodeNumber));
  const writeId = crypto.randomUUID();
  const statements = [categoryFence(db, next.category), updateStatement(db, next, expectedVersion, writeId)];
  if (numberingChanged && snapshotOwnsNumber) {
    statements.push(productionClaimReleaseStatement(db, next.id, next.version, writeId));
  } else if (numberingChanged) {
    statements.push(
      ...productionClaimReplaceStatements(
        db,
        next.id,
        next.version,
        writeId,
        next.category,
        next.episodeNumber,
      ),
    );
  }
  try {
    const results = await db.batch(statements);
    if (results[1].meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重试');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new HttpError(409, '该栏目下已有相同期数');
    }
    /* v8 ignore next */
    throw error;
  }
  return next;
}

export async function updateProduction(
  db: D1Database,
  id: string,
  actor: Actor,
  action: string,
  update: (current: Production) => Production,
  options: { expectedVersion?: number; feedback?: string } = {},
): Promise<Production> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await getProduction(db, id);
    if (options.expectedVersion !== undefined && current.version !== options.expectedVersion) {
      throw new HttpError(409, '内容已更新，请刷新后重试');
    }
    const changed = update(current);
    if (changed.id !== current.id || changed.version !== current.version)
      throw new HttpError(409, '不可修改制作任务的身份或版本');
    const next = appendEvent(changed, actor, action, options.feedback);
    try {
      return await saveProduction(db, next, current.version);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || options.expectedVersion !== undefined)
        throw error;
    }
  }
  throw new HttpError(409, '内容正在更新，请稍后重试');
}
