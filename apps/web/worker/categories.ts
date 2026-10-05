import {
  type Category,
  categoryInputSchema,
  categoryUpdateSchema,
  type PublicCategory,
} from '../src/shared/category';
import type { Actor } from '../src/shared/production';
import { HttpError, json } from './http';
import { readJson } from './production-body';
import { requireHuman } from './production-model';

const fields = 'id, name, icon, color, prompt, version, updated_at AS updatedAt, updated_by AS updatedBy';
export async function listCategories(db: D1Database) {
  return (
    await db.prepare('SELECT id, name, icon, color FROM categories ORDER BY rowid').all<PublicCategory>()
  ).results;
}
export async function getCategory(db: D1Database, id: string): Promise<Category> {
  const category = await db.prepare(`SELECT ${fields} FROM categories WHERE id=?`).bind(id).first<Category>();
  if (!category) throw new HttpError(404, '栏目不存在，请重新选择');
  return category;
}
export function categoryFence(db: D1Database, id: string) {
  return db
    .prepare(
      'INSERT OR REPLACE INTO category_write_fence (id,valid) VALUES (1,CASE WHEN EXISTS (SELECT 1 FROM categories WHERE id=?) THEN 1 ELSE 0 END)',
    )
    .bind(id);
}
export async function routeCategories(request: Request, env: Env, actor: Actor, id?: string) {
  if (request.method === 'GET')
    return id
      ? json({ category: await getCategory(env.DB, id) })
      : json({ categories: await listCategories(env.DB) });
  requireHuman(actor);
  if (!id && request.method === 'POST') {
    const input = await readJson(request, categoryInputSchema);
    const category = await env.DB.prepare(
      `INSERT INTO categories (id,name,icon,color,prompt,updated_at,updated_by) VALUES (?,?,?,?,?,?,?) RETURNING ${fields}`,
    )
      .bind(
        crypto.randomUUID(),
        input.name,
        input.icon,
        input.color,
        input.prompt,
        new Date().toISOString(),
        actor.name,
      )
      .first<Category>();
    return json({ category }, 201);
  }
  if (id && request.method === 'PUT') {
    const input = await readJson(request, categoryUpdateSchema);
    const category = await env.DB.prepare(
      `UPDATE categories SET name=?,icon=?,color=?,prompt=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=? RETURNING ${fields}`,
    )
      .bind(
        input.name,
        input.icon,
        input.color,
        input.prompt,
        new Date().toISOString(),
        actor.name,
        id,
        input.version,
      )
      .first<Category>();
    if (!category) throw new HttpError(409, '栏目已被修改或删除，草稿已保留，请刷新后对照');
    return json({ category });
  }
  if (id && request.method === 'DELETE') {
    const version = Number(new URL(request.url).searchParams.get('version'));
    if (!Number.isSafeInteger(version) || version < 1) throw new HttpError(400, '请提供栏目版本');
    const removed = await env.DB.prepare(
      "DELETE FROM categories WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM productions WHERE json_extract(data,'$.category')=?) AND NOT EXISTS (SELECT 1 FROM episodes WHERE category=?) RETURNING id",
    )
      .bind(id, version, id, id)
      .first();
    if (!removed) throw new HttpError(409, '栏目已被引用、修改或删除，不能直接删除');
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, '不支持这个请求方式');
}
