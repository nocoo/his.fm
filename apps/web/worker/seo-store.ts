import type { Actor } from '../src/shared/production';
import { type SiteSeoRecord, siteSeoSchema, siteSeoUpdateSchema } from '../src/shared/seo';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readJson } from './production-body';

const defaults = siteSeoSchema.parse({});

export async function getSiteSeo(db: D1Database): Promise<SiteSeoRecord> {
  const row = await db
    .prepare(
      'SELECT data, version, updated_at AS updatedAt, updated_by AS updatedBy FROM site_seo WHERE id = 1',
    )
    .first<{ data: string; version: number; updatedAt: string; updatedBy: string }>();
  if (!row) throw new HttpError(503, '站点 SEO 暂时无法读取，请重试');
  const data = siteSeoSchema.parse({ ...defaults, ...JSON.parse(row.data) });
  return { ...data, version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}

export async function routeSiteSeo(request: Request, env: Env, actor: Actor): Promise<Response> {
  if (request.method === 'GET') {
    requireScope(actor, 'prompts:read');
    return json({ seo: await getSiteSeo(env.DB) });
  }
  if (request.method !== 'PUT') throw new HttpError(405, '站点 SEO 使用 GET 读取、PUT 更新');
  requireScope(actor, 'prompts:write');
  const input = await readJson(request, siteSeoUpdateSchema);
  const { version, ...patch } = input;
  const current = await getSiteSeo(env.DB);
  const { version: _v, updatedAt: _a, updatedBy: _b, ...currentSeo } = current;
  const next = siteSeoSchema.parse({ ...currentSeo, ...patch });
  const row = await env.DB.prepare(
    'UPDATE site_seo SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING version, updated_at AS updatedAt, updated_by AS updatedBy',
  )
    .bind(JSON.stringify(next), new Date().toISOString(), actor.name, version)
    .first<{ version: number; updatedAt: string; updatedBy: string }>();
  if (!row) throw new HttpError(409, '站点 SEO 已在别处更新，请刷新后重试');
  return json({ seo: { ...next, ...row } });
}
