import { hasScope } from '@his-fm/contracts';
import {
  type Category,
  categoryCreateSchema,
  categoryMutationSchema,
  type PublicCategory,
} from '../src/shared/category';
import type { Actor } from '../src/shared/production';
import { parseSeoOverride } from '../src/shared/seo';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readJson } from './production-body';

const fields =
  'id, name, icon, color, prompt, seo, version, updated_at AS updatedAt, updated_by AS updatedBy';

function mapCategory(row: Category & { seo: string }): Category {
  return { ...row, seo: parseSeoOverride(row.seo) };
}
const categoryIdTaken = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed: categories\.id/.test(error.message);

export async function assertCategoryIdAvailable(db: D1Database, nextId: string, currentId?: string) {
  const occupied = await db.prepare('SELECT 1 FROM categories WHERE id = ?').bind(nextId).first();
  if (occupied && nextId !== currentId) throw new HttpError(409, '栏目 ID 已被占用，请换一个标识');
  if (!currentId) {
    const alias = await db.prepare('SELECT 1 FROM category_id_aliases WHERE alias = ?').bind(nextId).first();
    if (alias) throw new HttpError(409, '栏目 ID 已被占用，请换一个标识');
    return;
  }
  const reclaim = await db
    .prepare('SELECT 1 FROM category_id_aliases WHERE alias = ?')
    .bind(nextId)
    .first();
  if (reclaim) {
    await db.prepare('DELETE FROM category_id_aliases WHERE alias = ?').bind(nextId).run();
  }
}

export async function listCategories(db: D1Database) {
  const rows = await db.prepare('SELECT id, name, icon, color, seo FROM categories ORDER BY rowid').all<{
    id: string;
    name: string;
    icon: PublicCategory['icon'];
    color: PublicCategory['color'];
    seo: string;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    seo: parseSeoOverride(row.seo),
  }));
}
export async function getCategory(db: D1Database, id: string): Promise<Category> {
  const category = await db
    .prepare(`SELECT ${fields} FROM categories WHERE id=?`)
    .bind(id)
    .first<Category & { seo: string }>();
  if (!category) throw new HttpError(404, '栏目不存在，请重新选择');
  return mapCategory(category);
}
export function categoryFence(db: D1Database, id: string) {
  return db
    .prepare(
      'INSERT OR REPLACE INTO category_write_fence (id,valid) VALUES (1,CASE WHEN EXISTS (SELECT 1 FROM categories WHERE id=?) THEN 1 ELSE 0 END)',
    )
    .bind(id);
}
export async function renameCategoryId(
  db: D1Database,
  actor: Actor,
  id: string,
  nextId: string,
  inputVersion: number,
  merged: Pick<Category, 'name' | 'icon' | 'color' | 'prompt' | 'seo'>,
): Promise<Category> {
  const now = new Date().toISOString();
  const renamedVersion = inputVersion + 1;
  let results: Awaited<ReturnType<D1Database['batch']>>;
  try {
    results = await db.batch([
      db
        .prepare(
          `INSERT INTO categories (id,name,icon,color,prompt,seo,version,updated_at,updated_by)
         SELECT ?,?,?,?,?,?,version+1,?,?
         FROM categories WHERE id=? AND version=?`,
        )
        .bind(
          nextId,
          merged.name,
          merged.icon,
          merged.color,
          merged.prompt,
          JSON.stringify(merged.seo ?? {}),
          now,
          actor.name,
          id,
          inputVersion,
        ),
      db
        .prepare(
          `UPDATE episodes SET category=?, version=version+1, updated_at=?
         WHERE category=?
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)`,
        )
        .bind(nextId, now, id, nextId, renamedVersion, id, inputVersion),
      db
        .prepare(
          `UPDATE productions SET
           data=json_set(
             json_set(
               json_set(data,'$.category',?),
               '$.version',CAST(json_extract(data,'$.version') AS INTEGER)+1
             ),
             '$.updatedAt',?
           ),
           version=version+1,
           updated_at=?
         WHERE json_extract(data,'$.category')=?
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)`,
        )
        .bind(nextId, now, now, id, nextId, renamedVersion, id, inputVersion),
      db
        .prepare(
          `UPDATE episode_number_claims SET category = ?
         WHERE category = ?
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)`,
        )
        .bind(nextId, id, id, inputVersion),
      db
        .prepare(
          `UPDATE category_id_aliases SET category_id = ?
         WHERE category_id = ?
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)`,
        )
        .bind(nextId, id, id, inputVersion),
      db
        .prepare(
          `DELETE FROM category_id_aliases WHERE alias = ?
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)`,
        )
        .bind(nextId, id, inputVersion),
      db
        .prepare(
          'INSERT INTO category_id_aliases (alias, category_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)',
        )
        .bind(id, nextId, id, inputVersion),
      db
        .prepare(
          `DELETE FROM categories WHERE id=? AND version=?
         AND EXISTS (SELECT 1 FROM categories WHERE id=? AND version=?)`,
        )
        .bind(id, inputVersion, nextId, renamedVersion),
    ]);
  } catch (error) {
    if (categoryIdTaken(error)) throw new HttpError(409, '栏目 ID 已被占用，请换一个标识');
    throw error;
  }
  if (results[0].meta.changes !== 1 || results[7].meta.changes !== 1) {
    throw new HttpError(409, '栏目已被修改或删除，草稿已保留，请刷新后对照');
  }
  return getCategory(db, nextId);
}
export async function routeCategories(request: Request, env: Env, actor: Actor, id?: string) {
  const project = (category: Category) => {
    const { prompt, ...metadata } = category;
    return hasScope(actor, 'prompts:read') ? { ...metadata, prompt } : metadata;
  };
  if (request.method === 'GET') {
    requireScope(actor, 'categories:read');
    return id
      ? json({ category: project(await getCategory(env.DB, id)) })
      : json({
          categories: (
            await env.DB.prepare(`SELECT ${fields} FROM categories ORDER BY rowid`).all<
              Category & { seo: string }
            >()
          ).results.map((row) => project(mapCategory(row))),
        });
  }
  if (!id && request.method === 'POST') {
    requireScope(actor, 'categories:write');
    const input = await readJson(request, categoryCreateSchema);
    if (input.prompt) requireScope(actor, 'prompts:write');
    const category = await env.DB.prepare(
      `INSERT INTO categories (id,name,icon,color,prompt,seo,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?) RETURNING ${fields}`,
    )
      .bind(
        crypto.randomUUID(),
        input.name,
        input.icon,
        input.color,
        input.prompt ?? '',
        JSON.stringify(input.seo ?? {}),
        new Date().toISOString(),
        actor.name,
      )
      .first<Category & { seo: string }>();
    if (!category) throw new HttpError(503, '栏目暂时无法创建，请重试');
    return json({ category: project(mapCategory(category)) }, 201);
  }
  if (id && request.method === 'PUT') {
    requireScope(actor, 'categories:write');
    const input = await readJson(request, categoryMutationSchema);
    const current = await getCategory(env.DB, id);
    if (input.prompt !== undefined && input.prompt !== current.prompt) requireScope(actor, 'prompts:write');
    const nextId = input.nextId?.trim();
    if (nextId && nextId !== id) {
      await assertCategoryIdAvailable(env.DB, nextId, id);
      const merged = {
        name: input.name ?? current.name,
        icon: input.icon ?? current.icon,
        color: input.color ?? current.color,
        prompt: input.prompt ?? current.prompt,
        seo: input.seo ?? current.seo,
      };
      const category = await renameCategoryId(env.DB, actor, id, nextId, input.version, merged);
      return json({ category: project(category) });
    }
    const category = await env.DB.prepare(
      `UPDATE categories SET name=?,icon=?,color=?,prompt=?,seo=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=? RETURNING ${fields}`,
    )
      .bind(
        input.name ?? current.name,
        input.icon ?? current.icon,
        input.color ?? current.color,
        input.prompt ?? current.prompt,
        JSON.stringify(input.seo ?? current.seo ?? {}),
        new Date().toISOString(),
        actor.name,
        id,
        input.version,
      )
      .first<Category & { seo: string }>();
    if (!category) throw new HttpError(409, '栏目已被修改或删除，草稿已保留，请刷新后对照');
    return json({ category: project(mapCategory(category)) });
  }
  if (id && request.method === 'DELETE') {
    requireScope(actor, 'categories:delete');
    const version = Number(new URL(request.url).searchParams.get('version'));
    if (!Number.isSafeInteger(version) || version < 1) throw new HttpError(400, '请提供栏目版本');
    const deletable = `EXISTS (
      SELECT 1 FROM categories c
      WHERE c.id = ? AND c.version = ?
      AND NOT EXISTS (SELECT 1 FROM productions WHERE json_extract(data,'$.category') = c.id)
      AND NOT EXISTS (SELECT 1 FROM episodes WHERE category = c.id)
    )`;
    const removed = await env.DB.batch([
      env.DB.prepare(`DELETE FROM category_id_aliases WHERE category_id = ? AND ${deletable}`).bind(
        id,
        id,
        version,
      ),
      env.DB.prepare(
        `DELETE FROM categories WHERE id = ? AND version = ?
         AND NOT EXISTS (SELECT 1 FROM productions WHERE json_extract(data,'$.category') = ?)
         AND NOT EXISTS (SELECT 1 FROM episodes WHERE category = ?)
         RETURNING id`,
      ).bind(id, version, id, id),
    ]);
    if (removed[1].meta.changes !== 1) throw new HttpError(409, '栏目已被引用、修改或删除，不能直接删除');
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, '不支持这个请求方式');
}
