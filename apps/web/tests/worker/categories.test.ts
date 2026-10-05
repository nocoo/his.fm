import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { type Category, categoryInputSchema } from '../../src/shared/category';
import { getCategory, listCategories, routeCategories } from '../../worker/categories';
import worker from '../../worker/index';
import { routeProductions } from '../../worker/production';
import { applyPatch } from '../../worker/production-model';
import { productionPrompts } from '../../worker/production-prompts';
import { agent, brief, type fixture, human, readyFixture } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
let mf: Miniflare;
let env: Env;
const origin = 'https://hisfm.dev.hexly.ai';
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
      "DELETE FROM categories WHERE id NOT IN ('work','learning','life','conversations')",
    ].map((sql) => env.DB.prepare(sql)),
  );
});
it('keeps original identities, returns public metadata without prompts, and validates icon/color inputs', async () => {
  expect((await listCategories(env.DB)).map((c) => c.id)).toEqual([
    'work',
    'learning',
    'life',
    'conversations',
  ]);
  expect(await getCategory(env.DB, 'work')).toMatchObject({ name: '工作之间', prompt: '', version: 1 });
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
  await expect(routeCategories(request('POST', input), env, agent)).rejects.toMatchObject({ status: 403 });
  await expect(getCategory(env.DB, 'missing')).rejects.toMatchObject({ status: 404 });
  expect((await routeCategories(request(), env, agent, category.id)).status).toBe(200);
  expect((await routeCategories(request(), env, agent)).status).toBe(200);
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
  const read = await routeProductions(request(), env, `/productions/${production.id}`, agent);
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
  const channel = { version: 1, content: 'GLOBAL-PROMPT', updatedAt: 'now', updatedBy: 'owner' };
  const prompts = productionPrompts(production, channel, category);
  for (const prompt of Object.values(prompts)) {
    expect(prompt.indexOf('GLOBAL-PROMPT')).toBeLessThan(prompt.indexOf(input.prompt.split('\n')[0]));
    expect(prompt).toContain('1. 全局提示词；2. 栏目提示词；3. 本期中心思想');
  }
  const changed = applyPatch(readyFixture(), { category: category.id }, human);
  expect(changed.stage).toBe('draft');
  expect(changed.approvals).toEqual({ brief: null, script: null, final: null });
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

import assert from 'node:assert/strict';
