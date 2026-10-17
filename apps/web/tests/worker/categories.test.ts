import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { type Category, categoryInputSchema } from '../../src/shared/category';
import {
  assertCategoryIdAvailable,
  getCategory,
  listCategories,
  renameCategoryId,
  routeCategories,
} from '../../worker/categories';
import { resolveCategoryAlias } from '../../worker/episode-public';
import worker from '../../worker/index';
import { routeProductions } from '../../worker/production';
import { applyPatch } from '../../worker/production-model';
import { productionPrompts } from '../../worker/production-prompts';
import { getProduction, saveProduction } from '../../worker/production-store';
import { defaultPrompts } from '../../worker/prompt-defaults';
import { agent, brief, type fixture, human, readyFixture } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
let mf: Miniflare;
let env: Env;
const origin = 'https://hisfm.dev.hexly.ai';
const reader = {
  ...agent,
  scopes: ['categories:read', 'productions:read', 'prompts:read'] as import('@his-fm/contracts').Scope[],
};
const input = {
  name: '研究笔记',
  icon: 'book-open' as const,
  color: 'teal' as const,
  prompt: '# 内部风格\n先讲结论，再交代证据边界。',
};
function request(method = 'GET', data?: unknown, path = '/admin/api/categories') {
  return new Request(origin + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
async function create() {
  const response = await routeCategories(request('POST', input), env, human);
  return ((await response.json()) as { category: Category }).category;
}
beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'category-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: { DB: { type: 'd1', name: 'categories' }, ENVIRONMENT: { type: 'json', value: 'local' } },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  for (const name of readdirSync(new URL('../../migrations/', import.meta.url)).sort())
    await env.DB.batch(
      readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
});
afterAll(() => mf.dispose());
beforeEach(async () => {
  await env.DB.batch(
    [
      'DELETE FROM productions',
      'DELETE FROM episodes',
      'DELETE FROM episode_number_claims',
      'DELETE FROM category_id_aliases',
      "DELETE FROM categories WHERE id NOT IN ('manager-notes','learning','life','conversations')",
    ].map((sql) => env.DB.prepare(sql)),
  );
});
it('keeps original identities, returns public metadata without prompts, and validates icon/color inputs', async () => {
  expect((await listCategories(env.DB)).map((c) => c.id)).toEqual([
    'manager-notes',
    'learning',
    'life',
    'conversations',
  ]);
  expect(await getCategory(env.DB, 'manager-notes')).toMatchObject({
    name: '主理人手札',
    prompt: '',
    version: 1,
  });
  expect(await getCategory(env.DB, 'learning')).toMatchObject({ name: '每日手冲', version: 1 });
  const category = await create();
  expect(category).toMatchObject({ ...input, version: 1 });
  const publicResponse = await worker.fetch(new Request(`${origin}/api/categories`), env);
  const data = await publicResponse.json();
  expect(JSON.stringify(data)).not.toContain(input.prompt);
  expect(JSON.stringify(data)).not.toContain('updatedBy');
  for (const patch of [
    { name: '' },
    { icon: 'arbitrary-script' },
    { color: '#000' },
    { prompt: 'x'.repeat(30001) },
    { private: 'x' },
  ])
    expect(categoryInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  await expect(routeCategories(request('POST', input), env, { ...agent, scopes: [] })).rejects.toMatchObject({
    status: 403,
  });
  await expect(getCategory(env.DB, 'missing')).rejects.toMatchObject({ status: 404 });
  expect((await routeCategories(request(), env, reader, category.id)).status).toBe(200);
  expect((await routeCategories(request(), env, reader)).status).toBe(200);
  expect((await worker.fetch(new Request(`${origin}/api/categories`, { method: 'POST' }), env)).status).toBe(
    405,
  );
});
it('updates with optimistic versions and rejects stale writes while preserving ID', async () => {
  const category = await create();
  const response = await routeCategories(
    request('PUT', { ...input, name: '新版栏目', version: 1 }),
    env,
    human,
    category.id,
  );
  expect(await response.json()).toMatchObject({
    category: { id: category.id, name: '新版栏目', version: 2 },
  });
  await expect(
    routeCategories(request('PUT', { ...input, version: 1 }), env, human, category.id),
  ).rejects.toMatchObject({ status: 409 });
  await expect(routeCategories(request('PATCH', input), env, human, category.id)).rejects.toMatchObject({
    status: 405,
  });
  await expect(routeCategories(request('DELETE'), env, human, category.id)).rejects.toMatchObject({
    status: 400,
  });
  expect(
    (
      await routeCategories(
        request('DELETE', undefined, `/admin/api/categories/${category.id}?version=2`),
        env,
        human,
        category.id,
      )
    ).status,
  ).toBe(204);
  await expect(
    routeCategories(
      request('DELETE', undefined, `/admin/api/categories/${category.id}?version=2`),
      env,
      human,
      category.id,
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it('creates productions when only legacy work category ids exist', async () => {
  await env.DB.prepare("UPDATE categories SET id='work', name='工作' WHERE id='manager-notes'").run();
  try {
    const response = await routeProductions(
      request('POST', { ...brief, category: 'work' }),
      env,
      '/productions',
      human,
    );
    assert(response);
    expect(response.status).toBe(201);
  } finally {
    await env.DB.prepare("UPDATE categories SET id='manager-notes', name='主理人手札' WHERE id='work'").run();
  }
});
it('accepts new categories in productions, prevents deleting referenced categories and injects ordered prompts', async () => {
  const category = await create();
  const response = await routeProductions(
    request('POST', { ...brief, category: category.id }),
    env,
    '/productions',
    human,
  );
  assert(response);
  const { production } = (await response.json()) as { production: ReturnType<typeof fixture> };
  const read = await routeProductions(request(), env, `/productions/${production.id}`, reader);
  expect(await read?.json()).toMatchObject({ categoryProfile: category });
  await expect(
    routeCategories(
      request('DELETE', undefined, `/admin/api/categories/${category.id}?version=1`),
      env,
      human,
      category.id,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    routeProductions(request('POST', { ...brief, category: 'missing' }), env, '/productions', human),
  ).rejects.toMatchObject({ status: 404 });
  const channel = {
    version: 1,
    content: 'GLOBAL-PROMPT',
    prompts: defaultPrompts,
    updatedAt: 'now',
    updatedBy: 'owner',
  };
  const prompts = productionPrompts(production, channel, category);
  for (const prompt of Object.values(prompts)) {
    expect(prompt.indexOf('GLOBAL-PROMPT')).toBeLessThan(prompt.indexOf(input.prompt.split('\n')[0]));
    expect(prompt).toContain('1. 全局提示词；2. 栏目提示词；3. 本期中心思想');
  }
  const changed = applyPatch(readyFixture(), { category: category.id }, human);
  expect(changed.stage).toBe('draft');
  expect(changed.approvals).toEqual({ brief: null, script: null, final: null });
});
it('renames category id and updates episode and production references', async () => {
  const category = await create();
  const productionResponse = await routeProductions(
    request('POST', { ...brief, category: category.id }),
    env,
    '/productions',
    human,
  );
  assert(productionResponse);
  const { production } = (await productionResponse.json()) as { production: ReturnType<typeof fixture> };
  await env.DB.prepare(
    'INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, status, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      'episode-category-rename',
      'category-rename',
      1,
      '栏目迁移',
      '摘要',
      '',
      '',
      '/images/episode-01.webp',
      category.id,
      '[]',
      0,
      'draft',
      0,
      '2026-09-25T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
    )
    .run();
  const nextId = 'renamed-category';
  const response = await routeCategories(
    request('PUT', { version: 1, nextId, name: '迁移后的栏目' }),
    env,
    human,
    category.id,
  );
  expect(await response.json()).toMatchObject({
    category: { id: nextId, name: '迁移后的栏目', version: 2 },
  });
  expect(await getCategory(env.DB, nextId)).toMatchObject({ id: nextId, version: 2 });
  expect(
    await env.DB.prepare('SELECT category_id AS categoryId FROM category_id_aliases WHERE alias = ?')
      .bind(category.id)
      .first<{ categoryId: string }>(),
  ).toEqual({ categoryId: nextId });
  await expect(getCategory(env.DB, category.id)).rejects.toMatchObject({ status: 404 });
  expect(
    await env.DB.prepare('SELECT category FROM episodes WHERE id=?')
      .bind('episode-category-rename')
      .first<{ category: string }>(),
  ).toEqual({ category: nextId });
  const current = await getProduction(env.DB, production.id);
  expect(current.category).toBe(nextId);
  const row = await env.DB.prepare('SELECT version, data FROM productions WHERE id=?')
    .bind(production.id)
    .first<{ version: number; data: string }>();
  expect(row?.version).toBe(current.version);
  const saved = await saveProduction(env.DB, { ...current, intent: '栏目迁移后仍可保存' }, current.version);
  expect(saved.version).toBe(current.version + 1);
});
it('keeps alias chain through successive category renames', async () => {
  const category = await create();
  const firstId = category.id;
  expect(
    (
      await routeCategories(
        request('PUT', { version: 1, nextId: 'rename-step-b', name: 'B' }),
        env,
        human,
        firstId,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await routeCategories(
        request('PUT', { version: 2, nextId: 'rename-step-c', name: 'C' }),
        env,
        human,
        'rename-step-b',
      )
    ).status,
  ).toBe(200);
  expect(await resolveCategoryAlias(env.DB, firstId)).toBe('rename-step-c');
  expect(await resolveCategoryAlias(env.DB, 'rename-step-b')).toBe('rename-step-c');
});

it('rejects stale rename versions without leaving duplicate categories or moved references', async () => {
  const category = await create();
  await routeCategories(request('PUT', { version: 1, name: '已改名' }), env, human, category.id);
  await expect(
    routeCategories(
      request('PUT', { version: 1, nextId: 'stale-rename-target', name: '不应成功' }),
      env,
      human,
      category.id,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await getCategory(env.DB, category.id)).toMatchObject({ name: '已改名', version: 2 });
  await expect(getCategory(env.DB, 'stale-rename-target')).rejects.toMatchObject({ status: 404 });
});
it('rejects reserved nextId values used by admin routes', async () => {
  const category = await create();
  for (const nextId of ['new', 'all']) {
    await expect(
      routeCategories(request('PUT', { version: 1, nextId }), env, human, category.id),
    ).rejects.toMatchObject({ status: 400 });
  }
});
it('does not move episode or production references when rename uses a stale version and nextId is already taken', async () => {
  const category = await create();
  await routeCategories(request('PUT', { version: 1, name: '已改名' }), env, human, category.id);
  const productionResponse = await routeProductions(
    request('POST', { ...brief, category: category.id }),
    env,
    '/productions',
    human,
  );
  assert(productionResponse);
  const { production } = (await productionResponse.json()) as { production: ReturnType<typeof fixture> };
  await env.DB.prepare(
    'INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, status, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      'episode-stale-rename-race',
      'stale-rename-race',
      1,
      '栏目迁移竞态',
      '摘要',
      '',
      '',
      '/images/episode-01.webp',
      category.id,
      '[]',
      0,
      'draft',
      0,
      '2026-09-25T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
    )
    .run();
  await expect(
    renameCategoryId(env.DB, human, category.id, 'learning', 1, {
      name: category.name,
      icon: category.icon,
      color: category.color,
      prompt: category.prompt,
      seo: category.seo,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await env.DB.prepare('SELECT category FROM episodes WHERE id=?')
      .bind('episode-stale-rename-race')
      .first<{ category: string }>(),
  ).toEqual({ category: category.id });
  expect((await getProduction(env.DB, production.id)).category).toBe(category.id);
  expect(await getCategory(env.DB, 'learning')).toMatchObject({ id: 'learning', version: 1 });
});
it('rejects category ids that already exist', async () => {
  await expect(assertCategoryIdAvailable(env.DB, 'learning')).rejects.toMatchObject({ status: 409 });
});
it('rejects legacy alias ids for new identifiers', async () => {
  await env.DB.prepare('INSERT INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
    .bind('legacy-slot', 'life')
    .run();
  await expect(assertCategoryIdAvailable(env.DB, 'legacy-slot')).rejects.toMatchObject({ status: 409 });
});
it('rejects category renames onto ids already used by another category', async () => {
  const category = await create();
  await expect(
    routeCategories(request('PUT', { version: 1, nextId: 'learning' }), env, human, category.id),
  ).rejects.toMatchObject({ status: 409 });
});
it('moves episode number claims when renaming category ids', async () => {
  const category = await create();
  await env.DB.prepare(
    'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
  )
    .bind(category.id, 1, 'claim-holder', 'episode')
    .run();
  const nextId = 'claims-renamed';
  await routeCategories(request('PUT', { version: 1, nextId, name: category.name }), env, human, category.id);
  expect(
    await env.DB.prepare('SELECT category FROM episode_number_claims WHERE holder_id = ?')
      .bind('claim-holder')
      .first<{ category: string }>(),
  ).toEqual({ category: nextId });
});
it('keeps aliases when category delete fails on a stale version', async () => {
  const category = await create();
  await env.DB.prepare('INSERT INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
    .bind('legacy-alias', category.id)
    .run();
  await expect(
    routeCategories(
      request('DELETE', undefined, `/admin/api/categories/${category.id}?version=99`),
      env,
      human,
      category.id,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await env.DB.prepare('SELECT category_id AS categoryId FROM category_id_aliases WHERE alias = ?')
      .bind('legacy-alias')
      .first<{ categoryId: string }>(),
  ).toEqual({ categoryId: category.id });
  expect(await getCategory(env.DB, category.id)).toMatchObject({ id: category.id, version: 1 });
});
it('deletes empty renamed categories after clearing inbound aliases', async () => {
  const category = await create();
  const nextId = 'delete-target';
  await routeCategories(request('PUT', { version: 1, nextId, name: category.name }), env, human, category.id);
  const response = await routeCategories(
    request('DELETE', undefined, `/admin/api/categories/${nextId}?version=2`),
    env,
    human,
    nextId,
  );
  expect(response.status).toBe(204);
});
it('preserves alias chains when renaming categories twice', async () => {
  const category = await create();
  const firstTarget = 'renamed-once';
  await routeCategories(
    request('PUT', { version: 1, nextId: firstTarget, name: category.name }),
    env,
    human,
    category.id,
  );
  const secondTarget = 'renamed-twice';
  await routeCategories(
    request('PUT', { version: 2, nextId: secondTarget, name: category.name }),
    env,
    human,
    firstTarget,
  );
  expect(
    await env.DB.prepare('SELECT category_id AS categoryId FROM category_id_aliases WHERE alias = ?')
      .bind(category.id)
      .first<{ categoryId: string }>(),
  ).toEqual({ categoryId: secondTarget });
  expect(
    await env.DB.prepare('SELECT category_id AS categoryId FROM category_id_aliases WHERE alias = ?')
      .bind(firstTarget)
      .first<{ categoryId: string }>(),
  ).toEqual({ categoryId: secondTarget });
});
it('reclaims alias ids when renaming a category onto a legacy alias', async () => {
  const category = await create();
  const other = await create();
  await env.DB.prepare('INSERT INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
    .bind('legacy-id', other.id)
    .run();
  await routeCategories(
    request('PUT', { version: 1, nextId: 'legacy-id', name: '回收标识' }),
    env,
    human,
    category.id,
  );
  expect(await getCategory(env.DB, 'legacy-id')).toMatchObject({ name: '回收标识' });
  expect(
    await env.DB.prepare('SELECT 1 FROM category_id_aliases WHERE alias = ?').bind('legacy-id').first(),
  ).toBeNull();
});
it('maps duplicate nextId insert races to conflict responses', async () => {
  const category = await create();
  await expect(
    renameCategoryId(env.DB, human, category.id, 'manager-notes', 1, {
      name: category.name,
      icon: category.icon,
      color: category.color,
      prompt: category.prompt,
      seo: category.seo,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await getCategory(env.DB, category.id)).toMatchObject({ id: category.id, version: 1 });
});
it('protects owner category writes with authentication and same-origin checks', async () => {
  expect((await worker.fetch(request(), env)).status).toBe(401);
  const login = await worker.fetch(request('POST', undefined, '/admin/api/dev-login'), env);
  const cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  const createRequest = request('POST', input);
  createRequest.headers.set('Cookie', cookie);
  expect((await worker.fetch(createRequest, env)).status).toBe(201);
  const unsafe = request('POST', input);
  unsafe.headers.set('Cookie', cookie);
  unsafe.headers.set('Origin', 'https://evil.example');
  expect((await worker.fetch(unsafe, env)).status).toBe(403);
});
