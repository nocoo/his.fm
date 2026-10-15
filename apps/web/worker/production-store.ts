import { hasScope } from '@his-fm/contracts';
import type { Actor, Production } from '../src/shared/production';
import { operationFence, operationReceipt } from './agent-runtime-operation';
import { categoryFence, getCategory } from './categories';
import { HttpError } from './http';

export function mediaUrl(env: Pick<Env, 'ENVIRONMENT'>, key: string) {
  return `${env.ENVIRONMENT === 'local' ? '/media' : 'https://f.no.mt'}/${key}`;
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
  return JSON.parse(row.data) as Production;
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

export function updateStatement(db: D1Database, production: Production, expectedVersion: number) {
  return db
    .prepare(
      'UPDATE productions SET version = ?, stage = ?, data = ?, updated_at = ? WHERE id = ? AND version = ?',
    )
    .bind(
      production.version,
      production.stage,
      JSON.stringify(production),
      production.updatedAt,
      production.id,
      expectedVersion,
    );
}

export async function saveProduction(db: D1Database, production: Production, expectedVersion: number) {
  await getCategory(db, production.category);
  const next = nextVersion(production, expectedVersion);
  const fence = operationFence(db);
  const results = await db.batch([
    ...fence,
    categoryFence(db, next.category),
    updateStatement(db, next, expectedVersion),
    ...operationReceipt(db, next),
  ]);
  const result = results[fence.length + 1];
  if (result.meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重试');
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
