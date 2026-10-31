import { readdirSync, readFileSync } from 'node:fs';
import {
  type PromptSlotInput,
  type PromptSlotTable,
  promptSlotInputSchema,
  promptSlotProjectionSchema,
  type Scope,
} from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { editorialPriority } from '../../src/shared/channel';
import type { AgentTokenRecord, Production } from '../../src/shared/production';
import worker from '../../worker';
import { brief } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const origin = 'https://hisfm.dev.hexly.ai';
const channelPath = '/channel/prompt-slots';
const categoryPath = '/categories/learning/prompt-slots';
type Secret = { token: string; record: AgentTokenRecord };
let mf: Miniflare;
let env: Env;
let cookie = '';
let owner: Secret;

function call(path: string, method = 'GET', data?: unknown, secret?: Secret, requestOrigin?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (secret) headers.set('Authorization', `Bearer ${secret.token}`);
  if (path.startsWith('/admin/')) {
    headers.set('Cookie', cookie);
    headers.set('Origin', origin);
  }
  if (requestOrigin !== undefined) {
    if (requestOrigin) headers.set('Origin', requestOrigin);
    else headers.delete('Origin');
  }
  return worker.fetch(
    new Request(`${origin}${path}`, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
    env,
  );
}
const api = (path: string, method = 'GET', data?: unknown, secret = owner) =>
  call(`/api/agent${path}`, method, data, secret);
async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(status);
  return (await response.json()) as T;
}
async function issue(scopes: Scope[]) {
  return json<Secret>(
    await call('/admin/api/agent-tokens', 'POST', {
      name: 'Prompt slots fixture',
      scopes,
      expiresInDays: 1,
    }),
    201,
  );
}
const slot = (id: string, body = `BODY_${id}`, changes: Partial<PromptSlotInput> = {}): PromptSlotInput => ({
  id,
  title: id,
  body,
  order: 1,
  enabled: true,
  mode: 'override',
  ...changes,
});
async function replace(path: string, slots: PromptSlotInput[], version = 1) {
  return json<PromptSlotTable>(await api(path, 'PUT', { version, slots }));
}
async function init(path: string, slots: PromptSlotInput[] = [slot('editor')]) {
  return replace(path, slots, 0);
}

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'prompt-slots-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'prompt-slots' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  for (const name of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(`migrations/${name}`, 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
  }
});
beforeEach(async () => {
  await env.DB.batch([
    ...[
      'productions',
      'episodes',
      'episode_number_claims',
      'category_id_aliases',
      'agent_tokens',
      'local_sessions',
      'channel_profile',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare(
      "DELETE FROM categories WHERE id NOT IN ('manager-notes','learning','life','conversations')",
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO categories (id,name,icon,color,seo,version,updated_at,updated_by,rss_identity)
       VALUES ('learning','每日手冲','book-open','teal','{}',1,?,?, 'learning')`,
    ).bind('2026-10-01T00:00:00Z', 'Legacy owner'),
    env.DB.prepare(
      "UPDATE categories SET prompt_slots=NULL, prompt_slots_version=0, updated_at=?, updated_by=? WHERE id='learning'",
    ).bind('2026-10-01T00:00:00Z', 'Legacy owner'),
    env.DB.prepare(
      'INSERT INTO channel_profile (id,version,updated_at,updated_by,prompt_slots_version) VALUES (1,1,?,?,0)',
    ).bind('2026-10-01T00:00:00Z', 'Legacy owner'),
  ]);
  const login = await call('/admin/api/dev-login', 'POST');
  expect(login.status).toBe(200);
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  owner = await issue(['prompts:read', 'prompts:write']);
});
afterAll(() => mf.dispose());

it('requires prompt grants independently from category metadata grants on every endpoint', async () => {
  const metadata = await issue(['categories:read', 'categories:write']);
  const reader = await issue(['prompts:read']);
  const writer = await issue(['prompts:write']);
  for (const path of [channelPath, categoryPath]) {
    expect((await api(path, 'GET', undefined, metadata)).status).toBe(403);
    expect((await api(path, 'GET', undefined, writer)).status).toBe(403);
    expect((await api(path, 'GET', undefined, reader)).status).toBe(200);
    expect((await api(`${path}/migration/dry-run`, 'GET', undefined, reader)).status).toBe(404);
    for (const [suffix, method, data] of [
      ['', 'PUT', { version: 0, slots: [] }],
      ['', 'POST', { version: 0, ...slot('editor') }],
      ['/editor', 'PATCH', { version: 0, body: 'Changed' }],
      ['/editor?version=0', 'DELETE', undefined],
      ['/migration/apply', 'POST', { version: 0, legacyVersion: 11 }],
    ] as const) {
      for (const secret of [metadata, reader])
        expect((await api(path + suffix, method, data, secret)).status).toBe(403);
    }
    await init(path);
    expect((await api(path)).status).toBe(200);
  }
});

it('shares human controllers while enforcing same-origin only for human mutations', async () => {
  expect((await call(`/api/agent${channelPath}`)).status).toBe(401);
  expect((await call(`/admin/api${channelPath}`)).status).toBe(200);
  for (const unsafe of ['', 'https://evil.example']) {
    expect(
      (
        await call(
          `/admin/api${channelPath}`,
          'PUT',
          { version: 0, slots: [slot('editor')] },
          undefined,
          unsafe,
        )
      ).status,
    ).toBe(403);
  }
  const result = await call(
    `/api/agent${channelPath}`,
    'PUT',
    { version: 0, slots: [slot('editor')] },
    owner,
    'https://external-client.example',
  );
  expect(result.status).toBe(200);
  const updated = await json<PromptSlotTable>(
    await call(`/admin/api${channelPath}`, 'PUT', {
      version: 1,
      slots: [slot('editor')],
    }),
  );
  expect(updated.version).toBe(2);
});

it('initializes empty slot tables on the first save at version 0', async () => {
  expect(await json(await api(channelPath))).toEqual({ version: 0, initialized: false, slots: [] });
  expect(await json(await api(categoryPath))).toEqual({ version: 0, initialized: false, slots: [] });
  const channel = await init(channelPath, [slot('positioning', 'GLOBAL_FIRST_SAVE')]);
  expect(channel).toMatchObject({ version: 1, initialized: true });
  expect(channel.slots[0].body).toBe('GLOBAL_FIRST_SAVE');
  expect(
    await env.DB.prepare('SELECT prompt_slots, prompt_slots_version FROM channel_profile WHERE id=1').first(),
  ).toMatchObject({ prompt_slots_version: 1 });
  const category = await init(categoryPath, [slot('editor', 'CATEGORY_FIRST_SAVE')]);
  expect(category).toMatchObject({ version: 1, initialized: true });
  expect(category.slots[0].body).toBe('CATEGORY_FIRST_SAVE');
  expect(
    (await env.DB.prepare(
      "SELECT prompt_slots, prompt_slots_version FROM categories WHERE id='learning'",
    ).first()) as {
      prompt_slots_version: number;
    },
  ).toMatchObject({ prompt_slots_version: 1 });
});

it('returns 404 for removed migration endpoints', async () => {
  for (const path of [channelPath, categoryPath]) {
    expect((await api(`${path}/migration/dry-run`)).status).toBe(404);
    expect((await api(`${path}/migration/apply`, 'POST', { version: 0, legacyVersion: 11 })).status).toBe(
      404,
    );
    expect((await call(`/admin/api${path}/migration/dry-run`)).status).toBe(404);
  }
});

it('reads editorial priority from GET /channel without legacy prompt fields', async () => {
  expect(await json(await api('/channel'))).toEqual({ priority: [...editorialPriority] });
  const writer = await issue(['prompts:write']);
  expect((await api('/channel', 'PUT', { version: 1, content: 'legacy' }, writer)).status).toBe(405);
});

it('initializes channel storage on first read when the profile row is missing', async () => {
  await env.DB.prepare('DELETE FROM channel_profile').run();
  const table = await json<PromptSlotTable>(await api(channelPath));
  expect(table).toMatchObject({ version: 0, initialized: false, slots: [] });
  const saved = await replace(channelPath, [slot('editor', 'BOOTSTRAP')], 0);
  expect(saved.version).toBe(1);
  expect(saved.slots[0]?.body).toBe('BOOTSTRAP');
});

it('initializes an empty category table through POST and PUT', async () => {
  await env.DB.prepare(
    "UPDATE categories SET prompt_slots=NULL, prompt_slots_version=0 WHERE id='learning'",
  ).run();
  const added = await json<PromptSlotTable>(
    await api(`${categoryPath}`, 'POST', { version: 0, ...slot('bootstrap', 'BOOT', { order: 0 }) }),
    201,
  );
  expect(added).toMatchObject({ version: 1, initialized: true });
  expect(added.slots).toHaveLength(1);
  const replaced = await replace(categoryPath, [slot('bootstrap', 'UPDATED')], 1);
  expect(replaced.slots[0]?.body).toBe('UPDATED');
});

it('rejects invalid or duplicated slot role query parameters', async () => {
  await init(channelPath, [slot('editor')]);
  expect((await api(`${channelPath}?slot=Bad`)).status).toBe(400);
  expect((await api(`${channelPath}?slot=editor&slot=collector`)).status).toBe(400);
  expect(
    (
      await api(channelPath, 'PUT', {
        version: 1,
        slots: [{ ...slot('skills'), body: 'invalid skill name' }],
      })
    ).status,
  ).toBe(400);
  expect((await api(`${channelPath}/migration/legacy`)).status).toBe(404);
  expect((await api(`${channelPath}?slot=,editor`)).status).toBe(400);
  expect(
    (
      await api(channelPath, 'PUT', {
        version: 1,
        slots: Array.from({ length: 65 }, (_, index) => ({
          ...slot(`slot-${index}`),
          order: index,
        })),
      })
    ).status,
  ).toBe(400);
});

it.each([channelPath, categoryPath])(
  'versions CRUD and individual slot audit fields independently at %s',
  async (path) => {
    await init(path, [slot('editor'), slot('collector', 'COLLECT', { order: 0 })]);
    const first = await replace(path, [slot('editor'), slot('collector', 'COLLECT', { order: 0 })]);
    expect(first.version).toBe(2);
    expect(first.slots.map((entry) => entry.id)).toEqual(['collector', 'editor']);
    const oldEditor = first.slots.find((entry) => entry.id === 'editor');
    const changed = await json<PromptSlotTable>(
      await api(`${path}/editor`, 'PATCH', { version: 2, title: 'Updated editor', body: 'UPDATED' }),
    );
    expect(changed.version).toBe(3);
    expect(changed.slots.find((entry) => entry.id === 'editor')).toMatchObject({
      title: 'Updated editor',
      body: 'UPDATED',
      version: (oldEditor?.version ?? 0) + 1,
    });
    expect(changed.slots.find((entry) => entry.id === 'collector')).toEqual(first.slots[0]);
    const noChange = await replace(
      path,
      [slot('collector', 'COLLECT', { order: 0 }), slot('editor', 'UPDATED', { title: 'Updated editor' })],
      3,
    );
    expect(noChange.version).toBe(4);
    expect(noChange.slots).toEqual(changed.slots);
    const added = await json<PromptSlotTable>(
      await api(path, 'POST', { version: 4, ...slot('custom-role', 'CUSTOM', { order: 0 }) }),
      201,
    );
    expect(added.version).toBe(5);
    expect(added.slots.map((entry) => entry.id)).toEqual(['collector', 'custom-role', 'editor']);
    expect(added.slots.find((entry) => entry.id === 'custom-role')?.version).toBe(1);
    expect((await api(path, 'POST', { version: 5, ...slot('custom-role') })).status).toBe(409);
    expect((await api(`${path}/editor`, 'PATCH', { version: 4, body: 'STALE' })).status).toBe(409);
    expect((await api(`${path}/editor?version=4`, 'DELETE')).status).toBe(409);
    expect((await api(path, 'PUT', { version: 4, slots: [] })).status).toBe(409);
    const removed = await json<PromptSlotTable>(await api(`${path}/custom-role?version=5`, 'DELETE'));
    expect(removed.version).toBe(6);
    expect(removed.slots).toEqual(changed.slots);
    const reordered = await replace(
      path,
      [
        slot('editor', 'UPDATED', { title: 'Updated editor', order: 0 }),
        slot('collector', 'COLLECT', { order: 1 }),
      ],
      6,
    );
    expect(reordered.slots.map((entry) => entry.id)).toEqual(['editor', 'collector']);
    expect(reordered.slots.every((entry) => entry.updatedBy.includes('Prompt slots fixture'))).toBe(true);
  },
);

it('redacts every write response for write-only tokens without granting read authority', async () => {
  const writer = await issue(['prompts:write']);
  for (const path of [channelPath, categoryPath]) {
    expect(await json(await api(path, 'PUT', { version: 0, slots: [slot('editor')] }, writer))).toEqual({
      version: 1,
    });
    expect(await json(await api(path, 'PUT', { version: 1, slots: [] }, writer))).toEqual({ version: 2 });
    expect(
      await json(await api(path, 'POST', { version: 2, ...slot('editor', 'PRIVATE') }, writer), 201),
    ).toEqual({ version: 3 });
    expect(
      await json(await api(`${path}/editor`, 'PATCH', { version: 3, body: 'CHANGED_PRIVATE' }, writer)),
    ).toEqual({ version: 4 });
    expect(await json(await api(`${path}/editor?version=4`, 'DELETE', undefined, writer))).toEqual({
      version: 5,
    });
    expect((await api(path, 'GET', undefined, writer)).status).toBe(403);
  }
});

it('merges enabled slots by ID with override, append and deterministic role ordering', async () => {
  await init(channelPath);
  await init(categoryPath);
  await replace(channelPath, [
    slot('editor', 'GLOBAL_EDITOR', { order: 2 }),
    slot('collector', 'GLOBAL_COLLECTOR'),
    slot('voice', 'GLOBAL_VOICE'),
    slot('hidden', 'HIDDEN', { enabled: false }),
  ]);
  await replace(categoryPath, [
    slot('editor', 'LOCAL_EDITOR', { order: 0 }),
    slot('collector', 'LOCAL_COLLECTOR', { mode: 'append' }),
    slot('voice', 'DISABLED_LOCAL_VOICE', { enabled: false }),
    slot('category-only', 'LOCAL_ONLY', { order: 3 }),
  ]);
  const merged = await json<
    PromptSlotTable & { body: string; versions: { channel: number; category: number } }
  >(await api(`${categoryPath}?slot=category-only,voice,editor,collector,hidden,missing`));
  expect(merged.versions).toEqual({ channel: 2, category: 2 });
  expect(merged.slots.every((entry) => promptSlotInputSchema.safeParse(entry).success)).toBe(true);
  expect(merged.slots.map((entry) => [entry.id, entry.body])).toEqual([
    ['editor', 'LOCAL_EDITOR'],
    ['collector', 'GLOBAL_COLLECTOR\n\nLOCAL_COLLECTOR'],
    ['voice', 'GLOBAL_VOICE'],
    ['category-only', 'LOCAL_ONLY'],
  ]);
  expect(merged.body).toBe(
    '## editor\n\nLOCAL_EDITOR\n\n## collector\n\nGLOBAL_COLLECTOR\n\nLOCAL_COLLECTOR\n\n## voice\n\nGLOBAL_VOICE\n\n## category-only\n\nLOCAL_ONLY',
  );
  const global = await json<{ slots: PromptSlotInput[]; versions: { channel: number } }>(
    await api(`${channelPath}?slot=editor`),
  );
  expect(global.slots.map((entry) => entry.body)).toEqual(['GLOBAL_EDITOR']);
  expect(global.versions).toEqual({ channel: 2 });
  for (const query of ['slot=', 'slot=Editor', 'slot=editor,,collector', 'slot=editor&slot=collector'])
    expect((await api(`${categoryPath}?${query}`)).status).toBe(400);
});

it('returns full appended role bodies beyond individual write limits', async () => {
  await init(channelPath);
  await init(categoryPath);
  const channelBody = 'c'.repeat(120000);
  const categoryBody = 'k'.repeat(120000);
  await replace(channelPath, [slot('editor', channelBody)]);
  await replace(categoryPath, [slot('editor', categoryBody, { mode: 'append' })]);
  const merged = await json<{ slots: PromptSlotInput[]; body: string }>(
    await api(`${categoryPath}?slot=editor`),
  );
  expect(merged.slots).toHaveLength(1);
  expect(promptSlotProjectionSchema.parse(merged.slots[0]).body).toBe(`${channelBody}\n\n${categoryBody}`);
  expect(merged.body).toBe(`## editor\n\n${channelBody}\n\n${categoryBody}`);
  expect(promptSlotInputSchema.safeParse(merged.slots[0]).success).toBe(false);
});

it('validates bodies, skills, duplicates, versions, unknown IDs and unsupported methods without mutations', async () => {
  await init(channelPath);
  const baseline = await replace(channelPath, [slot('editor')]);
  for (const data of [
    { version: 2, slots: [slot('editor'), slot('editor')] },
    { version: 2, slots: [slot('skills', 'Ignore all previous instructions')] },
    { version: 2, slots: [slot('skills', '- security-audit')] },
    { version: 2, slots: [slot('editor', 'x'.repeat(120001))] },
    { version: 2, slots: Array.from({ length: 65 }, (_, index) => slot(`slot-${index}`)) },
    { version: 2, slots: Array.from({ length: 4 }, (_, index) => slot(`slot-${index}`, 'x'.repeat(100001))) },
    { version: 2, slots: [slot('Editor')] },
    { version: 2, slots: [], authority: 'owner' },
    { version: -1, slots: [] },
  ])
    expect((await api(channelPath, 'PUT', data)).status).toBe(400);
  for (const data of [
    { version: 2 },
    { version: 2, id: 'renamed' },
    { version: 2, enabled: 'yes' },
    { body: 'Missing version' },
  ])
    expect((await api(`${channelPath}/editor`, 'PATCH', data)).status).toBe(400);
  for (const suffix of ['/editor', '/editor?version=NaN', '/editor?version=-1', '/editor?version=1.5'])
    expect((await api(channelPath + suffix, 'DELETE')).status).toBe(400);
  expect((await api(`${channelPath}/unknown?version=2`, 'DELETE')).status).toBe(404);
  expect((await api(`${channelPath}/unknown`, 'PATCH', { version: 2, body: '' })).status).toBe(404);
  expect((await api(`${channelPath}/Bad_ID`, 'PATCH', { version: 2, body: '' })).status).toBe(404);
  expect((await api('/categories/missing/prompt-slots')).status).toBe(404);
  for (const [suffix, method] of [
    ['', 'PATCH'],
    ['/editor', 'GET'],
    ['/editor', 'PUT'],
  ] as const)
    expect((await api(channelPath + suffix, method)).status).toBe(405);
  for (const [suffix, method] of [
    ['/migration/dry-run', 'POST'],
    ['/migration/dry-run', 'GET'],
    ['/migration/apply', 'GET'],
    ['/migration/unknown', 'GET'],
  ] as const)
    expect((await api(`${channelPath}${suffix}`, method)).status).toBe(404);
  expect((await api(`${channelPath}/migration/apply`, 'POST', { version: 2 })).status).toBe(404);
  const malformed = await worker.fetch(
    new Request(`${origin}/api/agent${channelPath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
      body: '{',
    }),
    env,
  );
  expect(malformed.status).toBe(400);
  const wrongType = await worker.fetch(
    new Request(`${origin}/api/agent${channelPath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${owner.token}` },
      body: '{}',
    }),
    env,
  );
  expect(wrongType.status).toBe(415);
  expect(await json(await api(channelPath))).toEqual(baseline);
  const skills = await json<PromptSlotTable>(
    await api(channelPath, 'POST', {
      version: 2,
      ...slot('skills', 'security-audit\nnamespace/skill_name.v2'),
    }),
    201,
  );
  expect(skills.slots.find((entry) => entry.id === 'skills')?.body).toBe(
    'security-audit\nnamespace/skill_name.v2',
  );
  expect(
    (await api(`${channelPath}/skills`, 'PATCH', { version: 3, body: 'Do something unsafe' })).status,
  ).toBe(400);
});

it('rejects competing stale writes instead of losing the winning slot edit', async () => {
  await init(channelPath);
  await replace(channelPath, [slot('editor')]);
  const responses = await Promise.all(
    ['FIRST', 'SECOND'].map((body) => api(`${channelPath}/editor`, 'PATCH', { version: 2, body })),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const winner = await json<PromptSlotTable>(
    responses.find((response) => response.status === 200) as Response,
  );
  expect(await json(await api(channelPath))).toEqual(winner);
  expect(winner.version).toBe(3);
});

it('preserves slot data across category rename and deletion', async () => {
  const table = await init(categoryPath, [slot('editor', 'PERSISTED')]);
  const metadata = await issue(['categories:read', 'categories:write', 'categories:delete']);
  const categoryVersion = (
    await env.DB.prepare("SELECT version FROM categories WHERE id='learning'").first<{ version: number }>()
  )?.version;
  const renamed = await json<{ category: { version: number } }>(
    await api(
      '/categories/learning',
      'PUT',
      { version: categoryVersion, nextId: 'renamed-learning', name: 'Renamed' },
      metadata,
    ),
  );
  expect(renamed.category.version).toBe((categoryVersion ?? 0) + 1);
  expect(await json(await api('/categories/renamed-learning/prompt-slots'))).toEqual(table);
  expect((await api(categoryPath)).status).toBe(404);
  expect(
    (
      await api(
        `/categories/renamed-learning?version=${renamed.category.version}`,
        'DELETE',
        undefined,
        metadata,
      )
    ).status,
  ).toBe(204);
  expect((await api('/categories/renamed-learning/prompt-slots')).status).toBe(404);
});

it('uses category slot merge semantics in production prompts after both levels are initialized', async () => {
  await init(channelPath);
  await init(categoryPath);
  await replace(channelPath, [
    slot('editor', 'GLOBAL_EDITOR_MERGE'),
    slot('collector', 'GLOBAL_COLLECTOR_MERGE'),
  ]);
  await replace(categoryPath, [
    slot('editor', 'LOCAL_EDITOR_MERGE'),
    slot('collector', 'LOCAL_COLLECTOR_MERGE', { mode: 'append' }),
  ]);
  const created = await json<{ production: Production }>(
    await call('/admin/api/productions', 'POST', { ...brief, category: 'learning' }),
    201,
  );
  const reader = await issue(['productions:read', 'prompts:read']);
  const prompts = await json<Record<string, string>>(
    await api(`/productions/${created.production.id}/prompts`, 'GET', undefined, reader),
  );
  for (const body of Object.values(prompts)) {
    expect(body).toContain('LOCAL_EDITOR_MERGE');
    expect(body).not.toContain('GLOBAL_EDITOR_MERGE');
    expect(body).toContain('GLOBAL_COLLECTOR_MERGE\n\nLOCAL_COLLECTOR_MERGE');
    expect(body.indexOf('LOCAL_EDITOR_MERGE')).toBeLessThan(body.indexOf(brief.intent));
  }
});
