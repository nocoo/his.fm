import { type Appearance, appearanceUpdateSchema } from '../src/shared/appearance';
import type { Actor } from '../src/shared/production';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readJson } from './production-body';

export async function getAppearance(db: D1Database): Promise<Appearance> {
  const appearance = await db
    .prepare(
      'SELECT theme, version, updated_at AS updatedAt, updated_by AS updatedBy FROM site_appearance WHERE id = 1',
    )
    .first<Appearance>();
  if (!appearance) throw new HttpError(503, '网站外观暂时无法读取，请重试');
  return appearance;
}

export async function routeAppearance(request: Request, env: Env, actor: Actor): Promise<Response> {
  if (request.method === 'GET') {
    requireScope(actor, 'appearance:read');
    return json({ appearance: await getAppearance(env.DB) });
  }
  if (request.method !== 'PUT') throw new HttpError(405, '网站外观使用 GET 读取、PUT 更新');
  requireScope(actor, 'appearance:write');
  const input = await readJson(request, appearanceUpdateSchema);
  const appearance = await env.DB.prepare(
    'UPDATE site_appearance SET theme = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING theme, version, updated_at AS updatedAt, updated_by AS updatedBy',
  )
    .bind(input.theme, new Date().toISOString(), actor.name, input.version)
    .first<Appearance>();
  if (!appearance) throw new HttpError(409, '网站外观已在别处更新。请读取最新设置后重新选择。');
  return json({ appearance });
}
