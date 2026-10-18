import { readdirSync, readFileSync } from 'node:fs';
import { type Principal, type Scope, wavHeader } from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { tinyMp3Bytes } from '../../../../packages/contracts/src/mp3-fixtures.ts';
import type { Episode } from '../../src/shared/episode';
import { routeAppearance } from '../../worker/appearance';
import { routeBumpers } from '../../worker/bumpers';
import { routeCategories } from '../../worker/categories';
import { getChannel, routeChannel } from '../../worker/channel';
import { getEpisode, listEpisodes, mutateEpisode } from '../../worker/episodes';
import { routeStorage } from '../../worker/storage';
import { agent, human } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
let mf: Miniflare;
let env: Env;
const origin = 'https://hisfm.dev.hexly.ai';
const unscoped: Principal = { kind: 'agent', name: agent.name };
const granted = (...scopes: Scope[]): Principal => ({ ...agent, scopes });
function request(method = 'GET', data?: unknown, path = '') {
  return new Request(`${origin}/admin/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
const draft = {
  slug: 'versioned-episode',
  episodeNumber: 1,
  title: 'Versioned episode',
  summary: 'Summary',
  transcript: '',
  showNotes: '',
  coverUrl: '/images/cover.webp',
  category: 'life',
  tags: [],
  durationSeconds: 0,
  audioUrl: null,
  status: 'draft',
  featured: false,
  publishedAt: null,
};
const wav = new Uint8Array(48044);
wav.set(wavHeader(wav.length - 44));
const upload = (type = 'audio/wav', bytes = wav, path = 'storage') =>
  new Request(`${origin}/admin/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: bytes,
  });
beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'resource-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'resources' },
            MEDIA: { type: 'r2', name: 'resources' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  for (const name of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await env.DB.batch(
      readFileSync(`migrations/${name}`, 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
});
beforeEach(async () => {
  await env.DB.batch(
    ['media_provenance', 'productions', 'episodes', 'episode_number_claims', 'bumpers'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});
afterAll(() => mf.dispose());

it('rejects unsupported resource methods and unavailable profile storage', async () => {
  for (const result of [
    () => routeAppearance(request('POST'), env, human),
    () => routeChannel(request('PATCH'), env, human),
    () => mutateEpisode(request('GET'), env.DB, human),
    () => mutateEpisode(request('PUT'), env.DB, human),
    () => mutateEpisode(request('POST'), env.DB, human, 'unexpected-id'),
  ])
    await expect(result()).rejects.toMatchObject({ status: 405 });
  await expect(
    mutateEpisode(request('PUT', { ...draft, version: 1 }), env.DB, human, 'missing'),
  ).rejects.toMatchObject({ status: 404 });
  await expect(routeBumpers(request(), env, human, 'missing')).rejects.toMatchObject({ status: 404 });
  await expect(
    routeBumpers(request('DELETE', undefined, '?version=1'), env, human, 'missing'),
  ).rejects.toMatchObject({ status: 404 });
  const unavailable = {
    ...env,
    DB: {
      prepare: () => ({
        bind() {
          return this;
        },
        run: async () => ({}),
        first: async () => null,
      }),
    } as unknown as D1Database,
  };
  await expect(routeAppearance(request(), unavailable, human)).rejects.toMatchObject({ status: 503 });
  await expect(routeChannel(request(), unavailable, human)).rejects.toMatchObject({ status: 503 });
  await expect(
    routeCategories(request('POST', { name: 'Name', icon: 'leaf', color: 'teal' }), unavailable, human),
  ).rejects.toMatchObject({ status: 503 });
});

it('keeps deprecated channel fields read-only and returns full profiles only with read grants', async () => {
  const current = await getChannel(env.DB);
  await expect(
    routeChannel(request('PUT', { version: current.version, prompts: current.prompts }), env, human),
  ).rejects.toMatchObject({ status: 405 });
  expect(await getChannel(env.DB)).toEqual(current);
  const created = await routeCategories(
    request('POST', { name: 'Metadata only', icon: 'leaf', color: 'teal' }),
    env,
    granted('categories:write'),
  );
  expect(JSON.stringify(await created.json())).not.toContain('prompt');
});

it('fails closed on every private controller without grants, including internal episode reads', async () => {
  for (const result of [
    () => routeCategories(request(), env, unscoped),
    () => routeChannel(request(), env, unscoped),
    () => routeAppearance(request(), env, unscoped),
    () => routeBumpers(request(), env, unscoped),
    () => routeStorage(request('GET', undefined, 'storage'), env, unscoped),
    () => listEpisodes(env.DB, false),
    () => getEpisode(env.DB, 'missing', false),
    () => listEpisodes(env.DB, false, unscoped),
    () => getEpisode(env.DB, 'missing', false, unscoped),
    () => mutateEpisode(request('POST', draft), env.DB, unscoped),
    () => routeCategories(request('POST'), env, unscoped),
    () => routeCategories(request('PUT'), env, unscoped, 'manager-notes'),
    () => routeCategories(request('DELETE'), env, unscoped, 'manager-notes'),
    () => routeChannel(request('PUT'), env, unscoped),
    () => routeAppearance(request('PUT'), env, unscoped),
    () => routeBumpers(request('POST'), env, unscoped),
    () => routeBumpers(request('PUT'), env, unscoped, 'missing'),
    () => routeBumpers(request('DELETE'), env, unscoped, 'missing'),
    () => routeStorage(request('POST', undefined, 'storage/cleanup'), env, unscoped),
    () => routeStorage(request('DELETE', undefined, 'storage/object'), env, unscoped),
  ])
    await expect(result()).rejects.toMatchObject({ status: 403 });
  expect(await listEpisodes(env.DB, true)).toEqual([]);
});

it('versions standalone episodes, separates publishing from editing, and protects linked snapshots', async () => {
  const editor = granted('episodes:write');
  const created = await mutateEpisode(request('POST', draft), env.DB, editor);
  expect(created.status).toBe(201);
  const { episode } = (await created.json()) as { episode: Pick<Episode, 'id' | 'version'> };
  expect(episode.version).toBe(1);
  expect((await listEpisodes(env.DB, false, granted('episodes:read')))[0].id).toBe(episode.id);
  expect((await getEpisode(env.DB, episode.id, false, granted('episodes:read'))).version).toBe(1);
  await expect(mutateEpisode(request('PUT', draft), env.DB, editor, episode.id)).rejects.toMatchObject({
    status: 400,
  });
  const updated = await mutateEpisode(
    request('PUT', { ...draft, title: 'Revised', version: 1 }),
    env.DB,
    editor,
    episode.id,
  );
  expect(await updated.json()).toEqual({ episode: { id: episode.id, version: 2 } });
  expect(await getEpisode(env.DB, episode.id, false, human)).toMatchObject({ title: 'Revised', version: 2 });
  await expect(
    mutateEpisode(request('PUT', { ...draft, version: 1 }), env.DB, editor, episode.id),
  ).rejects.toMatchObject({ status: 409 });
  const publication = { ...draft, version: 2, status: 'published', publishedAt: '2020-01-01T00:00:00Z' };
  await expect(mutateEpisode(request('PUT', publication), env.DB, editor, episode.id)).rejects.toMatchObject({
    status: 403,
  });
  await mutateEpisode(
    request('PUT', publication),
    env.DB,
    granted('episodes:write', 'episodes:publish'),
    episode.id,
  );
  expect((await getEpisode(env.DB, draft.slug, true)).status).toBe('published');
  await expect(
    mutateEpisode(request('PUT', { ...draft, version: 3 }), env.DB, editor, episode.id),
  ).rejects.toMatchObject({ status: 403 });
  await env.DB.prepare('UPDATE episodes SET source_production_id=? WHERE id=?')
    .bind('source', episode.id)
    .run();
  await expect(
    mutateEpisode(request('PUT', { ...draft, version: 3 }), env.DB, human, episode.id),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    mutateEpisode(request('DELETE', undefined, '?version=3'), env.DB, human, episode.id),
  ).rejects.toMatchObject({ status: 409 });
  const featured = await mutateEpisode(
    request('PATCH', { featured: true, version: 3 }),
    env.DB,
    editor,
    episode.id,
  );
  expect(await featured.json()).toEqual({ episode: { id: episode.id, version: 4 } });
  expect(await getEpisode(env.DB, episode.id, false, human)).toMatchObject({
    version: 4,
    featured: true,
    status: 'published',
    title: draft.title,
    sourceProductionId: 'source',
  });
  await expect(
    mutateEpisode(request('PATCH', { featured: false, version: 3 }), env.DB, editor, episode.id),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    mutateEpisode(
      request('PATCH', { title: 'Tampered', featured: false, version: 4 }),
      env.DB,
      editor,
      episode.id,
    ),
  ).rejects.toMatchObject({ status: 400 });
});

it('requires expected versions for deletion and retains stale episode data', async () => {
  const create = await mutateEpisode(request('POST', draft), env.DB, human);
  const { episode } = (await create.json()) as { episode: Episode };
  await expect(mutateEpisode(request('DELETE'), env.DB, human, episode.id)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    mutateEpisode(request('DELETE', undefined, '?version=2'), env.DB, human, episode.id),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    mutateEpisode(request('DELETE', undefined, '?version=1'), env.DB, granted('episodes:write'), episode.id),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (
      await mutateEpisode(
        request('DELETE', undefined, '?version=1'),
        env.DB,
        granted('episodes:delete'),
        episode.id,
      )
    ).status,
  ).toBe(204);
  await expect(getEpisode(env.DB, episode.id, false, human)).rejects.toMatchObject({ status: 404 });
});

it('bounds and validates episode bodies and preserves the original on slug conflicts', async () => {
  await mutateEpisode(request('POST', draft), env.DB, human);
  await expect(mutateEpisode(request('POST', draft), env.DB, human)).rejects.toMatchObject({ status: 409 });
  for (const [headers, body, status] of [
    [{}, JSON.stringify(draft), 415],
    [{ 'Content-Type': 'application/json' }, undefined, 400],
    [{ 'Content-Type': 'application/json' }, '{', 400],
    [{ 'Content-Type': 'application/json', 'Content-Length': '512001' }, '{}', 413],
    [{ 'Content-Type': 'application/json' }, 'x'.repeat(512001), 413],
  ] as const) {
    const invalid = new Request(origin, { method: 'POST', headers, body });
    await expect(mutateEpisode(invalid, env.DB, human)).rejects.toMatchObject({ status });
  }
  expect(
    (await getEpisode(env.DB, (await listEpisodes(env.DB, false, human))[0].id, false, human)).title,
  ).toBe(draft.title);
  await expect(
    mutateEpisode(
      request('POST', { ...draft, slug: 'schedule', publishedAt: '2030-01-01T00:00:00Z' }),
      env.DB,
      granted('episodes:write'),
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('projects private category prompts independently and preserves omitted prompt fields', async () => {
  const category = { name: 'Private', icon: 'leaf', color: 'teal', prompt: 'SECRET PROMPT' };
  const { prompt: _prompt, ...fields } = category;
  const create = await routeCategories(request('POST', fields), env, human);
  const { category: saved } = (await create.json()) as { category: { id: string } };
  await env.DB.prepare('UPDATE categories SET prompt=? WHERE id=?').bind(category.prompt, saved.id).run();
  const metadata = granted('categories:read', 'categories:write');
  const response = await routeCategories(request(), env, metadata, saved.id);
  expect(await response.json()).toMatchObject({ category: { id: saved.id, version: 1 } });
  const list = await routeCategories(request(), env, metadata);
  expect(JSON.stringify(await list.json())).not.toContain('SECRET PROMPT');
  const update = await routeCategories(
    request('PUT', { ...fields, name: 'Renamed', version: 1 }),
    env,
    metadata,
    saved.id,
  );
  expect(JSON.stringify(await update.json())).not.toContain('SECRET PROMPT');
  expect(
    await (
      await routeCategories(request(), env, granted('categories:read', 'prompts:read'), saved.id)
    ).json(),
  ).toMatchObject({ category: { name: 'Renamed', prompt: 'SECRET PROMPT', version: 2 } });
  await expect(
    routeCategories(request('PUT', { ...category, prompt: '', version: 2 }), env, metadata, saved.id),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    routeCategories(request('PUT', { ...category, version: 2 }), env, metadata, saved.id),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    routeCategories(
      request('PUT', { prompt: 'New private prompt', version: 2 }),
      env,
      granted('categories:write', 'prompts:write', 'prompts:read'),
      saved.id,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    await env.DB.prepare('SELECT prompt, version FROM categories WHERE id=?').bind(saved.id).first(),
  ).toEqual({ prompt: category.prompt, version: 2 });
  await expect(
    routeCategories(request('PUT', { version: 4 }), env, metadata, saved.id),
  ).rejects.toMatchObject({ status: 400 });
  await expect(routeCategories(request('POST', category), env, metadata)).rejects.toMatchObject({
    status: 403,
  });
  await expect(routeCategories(request('POST', category), env, human)).rejects.toMatchObject({
    status: 400,
  });
});

it('rejects legacy channel writes and authorizes versioned appearance writes', async () => {
  const channel = await getChannel(env.DB);
  await expect(
    routeChannel(
      request('PUT', { version: channel.version, content: 'Private updated prompt' }),
      env,
      granted('prompts:write'),
    ),
  ).rejects.toMatchObject({ status: 405 });
  await expect(
    routeChannel(request('PUT', { version: channel.version, content: 'Stale' }), env, human),
  ).rejects.toMatchObject({ status: 405 });
  expect(await (await routeChannel(request(), env, granted('prompts:read'))).json()).toMatchObject({
    channel,
  });
  await expect(
    routeChannel(request('PUT', { version: 1, content: 'No grant' }), env, granted('prompts:read')),
  ).rejects.toMatchObject({ status: 403 });
  const read = await routeAppearance(request(), env, granted('appearance:read'));
  const { appearance } = (await read.json()) as { appearance: { version: number; theme: string } };
  const update = await routeAppearance(
    request('PUT', { theme: appearance.theme, version: appearance.version }),
    env,
    granted('appearance:write'),
  );
  expect(await update.json()).toMatchObject({
    appearance: { version: appearance.version + 1, updatedBy: agent.name },
  });
  await expect(
    routeAppearance(request('PUT', { theme: appearance.theme, version: appearance.version }), env, human),
  ).rejects.toMatchObject({
    status: 409,
  });
});

it('supports versioned bumper metadata and refuses removal of referenced snapshots without deleting media', async () => {
  const created = await routeBumpers(
    upload('audio/wav', wav, 'bumpers?name=Opening&position=intro'),
    env,
    granted('bumpers:write'),
  );
  const ack = (await created.json()) as { bumper: { id: string; version: number } };
  expect(ack).toEqual({ bumper: { id: expect.any(String), version: 1 } });
  const { bumper } = (await (
    await routeBumpers(request(), env, granted('bumpers:read'), ack.bumper.id)
  ).json()) as { bumper: { id: string; key: string } };
  const edit = { version: 1, name: 'Closing', position: 'outro' };
  const updated = await routeBumpers(request('PUT', edit), env, granted('bumpers:write'), bumper.id);
  expect(await updated.json()).toEqual({ bumper: { id: bumper.id, version: 2 } });
  expect(await (await routeBumpers(request(), env, human, bumper.id)).json()).toMatchObject({
    bumper: { key: bumper.key, name: 'Closing', version: 2 },
  });
  await expect(routeBumpers(request('PUT', edit), env, human, bumper.id)).rejects.toMatchObject({
    status: 409,
  });
  await expect(routeBumpers(request('DELETE'), env, human, bumper.id)).rejects.toMatchObject({ status: 400 });
  await expect(
    routeBumpers(request('DELETE', undefined, '?version=1'), env, human, bumper.id),
  ).rejects.toMatchObject({ status: 409 });
  await env.DB.prepare("INSERT INTO media_provenance VALUES ('settings',?)")
    .bind(JSON.stringify({ intro: { key: bumper.key } }))
    .run();
  await expect(
    routeBumpers(request('DELETE', undefined, '?version=2'), env, human, bumper.id),
  ).rejects.toMatchObject({ status: 409 });
  await env.DB.prepare('DELETE FROM media_provenance').run();
  await env.DB.prepare("INSERT INTO media_provenance VALUES ('snapshot',?)")
    .bind(JSON.stringify({ introKey: bumper.key }))
    .run();
  await expect(
    routeBumpers(request('DELETE', undefined, '?version=2'), env, human, bumper.id),
  ).rejects.toMatchObject({ status: 409 });
  await env.DB.prepare('DELETE FROM media_provenance').run();
  expect(
    (
      await routeBumpers(
        request('DELETE', undefined, '?version=2'),
        env,
        granted('bumpers:delete'),
        bumper.id,
      )
    ).status,
  ).toBe(204);
  expect(await env.MEDIA.head(bumper.key)).not.toBeNull();
});

it('uploads immutable validated media and applies storage grants and versioned deletion safety', async () => {
  await expect(routeStorage(upload(), env, unscoped)).rejects.toMatchObject({ status: 403 });
  await expect(
    routeStorage(upload('image/svg+xml', new TextEncoder().encode('<svg/>')), env, human),
  ).rejects.toMatchObject({ status: 415 });
  await expect(routeStorage(upload('image/png'), env, human)).rejects.toMatchObject({ status: 415 });
  await expect(
    routeStorage(upload('audio/wav', wav, 'storage?key=images/hero.wav'), env, human),
  ).rejects.toMatchObject({ status: 400 });
  const created = await routeStorage(upload(), env, granted('storage:write'));
  expect(created.status).toBe(201);
  const { object } = (await created.json()) as { object: { key: string; version: string } };
  expect(object.key).toMatch(/^uploads\/[a-f0-9-]+\.wav$/);
  expect(await env.MEDIA.head(object.key)).toMatchObject({ httpMetadata: { contentType: 'audio/wav' } });
  const mp3Created = await routeStorage(upload('audio/mpeg', tinyMp3Bytes), env, granted('storage:write'));
  expect(mp3Created.status).toBe(201);
  const mp3Object = (await mp3Created.json()) as { object: { key: string } };
  expect(mp3Object.object.key).toMatch(/^uploads\/[a-f0-9-]+\.mp3$/);
  expect(await env.MEDIA.head(mp3Object.object.key)).toMatchObject({
    httpMetadata: { contentType: 'audio/mpeg' },
  });
  const voiceKey = 'reference/voices/elevenlabs-Bill.mp3';
  for (const denied of [
    upload('audio/mpeg', tinyMp3Bytes, `storage?key=${encodeURIComponent('uploads/evil.mp3')}`),
    upload('audio/wav', wav, `storage?key=${encodeURIComponent(voiceKey)}`),
    upload('audio/mpeg', tinyMp3Bytes, `storage?key=${encodeURIComponent(voiceKey)}&evil=1`),
    upload('audio/mpeg', tinyMp3Bytes, `storage?key=${encodeURIComponent('reference/voices/../evil.mp3')}`),
  ]) {
    await expect(routeStorage(denied, env, granted('storage:write'))).rejects.toMatchObject({
      status: expect.any(Number),
    });
  }
  const named = await routeStorage(
    upload('audio/mpeg', tinyMp3Bytes, `storage?key=${encodeURIComponent(voiceKey)}`),
    env,
    granted('storage:write'),
  );
  expect(named.status).toBe(201);
  const namedObject = (await named.json()) as { object: { key: string; version: string } };
  expect(namedObject.object.key).toBe(voiceKey);
  expect(await env.MEDIA.head(voiceKey)).toMatchObject({
    httpMetadata: { cacheControl: 'public, max-age=300, must-revalidate' },
  });
  const replaced = await routeStorage(
    upload('audio/mpeg', tinyMp3Bytes, `storage?key=${encodeURIComponent(voiceKey)}`),
    env,
    granted('storage:write'),
  );
  expect(replaced.status).toBe(201);
  expect(((await replaced.json()) as { object: { version: string } }).object.version).not.toBe(
    namedObject.object.version,
  );
  const path = `storage/object?key=${encodeURIComponent(object.key)}&version=${object.version}`;
  await expect(
    routeStorage(request('DELETE', undefined, path), env, granted('storage:write')),
  ).rejects.toMatchObject({ status: 403 });
  const result = await routeStorage(request('DELETE', undefined, path), env, granted('storage:delete'));
  expect(await result.json()).toMatchObject({ results: [{ status: 'skipped' }] });
  const aged = {
    ...env,
    MEDIA: {
      head: async (key: string) => {
        const value = await env.MEDIA.head(key);
        return value ? { ...value, uploaded: new Date('2020-01-01') } : null;
      },
      delete: env.MEDIA.delete.bind(env.MEDIA),
    } as R2Bucket,
  };
  const removed = await routeStorage(request('DELETE', undefined, path), aged, granted('storage:delete'));
  expect(await removed.json()).toMatchObject({ results: [{ status: 'deleted' }] });
  expect(await env.MEDIA.head(object.key)).toBeNull();
});

it('rejects malformed or mismatched media and never overwrites an existing immutable upload', async () => {
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const extra = new Uint8Array([...wav, 0]);
  for (const invalid of [
    upload('audio/wav', new Uint8Array(2)),
    upload('audio/wav', extra),
    upload('image/jpeg', png),
  ])
    await expect(routeStorage(invalid, env, human)).rejects.toMatchObject({ status: 415 });
  await expect(
    routeBumpers(upload('audio/wav', extra, 'bumpers?name=Extra&position=intro'), env, human),
  ).rejects.toMatchObject({ status: 400 });
  const oversized = upload();
  oversized.headers.set('Content-Length', String(26 * 1024 * 1024));
  await expect(routeStorage(oversized, env, human)).rejects.toMatchObject({ status: 413 });
  await expect(
    routeStorage(new Request(`${origin}/admin/api/storage`, { method: 'POST' }), env, human),
  ).rejects.toMatchObject({ status: 415 });
  const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
  try {
    const initial = await routeStorage(upload('image/png', png), env, human);
    const { object } = (await initial.json()) as {
      object: { key: string; version: string; contentType: string };
    };
    expect(object.contentType).toBe('image/png');
    await expect(routeStorage(upload('image/png', png), env, human)).rejects.toMatchObject({ status: 409 });
    expect((await env.MEDIA.head(object.key))?.version).toBe(object.version);
    await routeBumpers(upload('audio/wav', wav, 'bumpers?name=Original&position=intro'), env, human);
    await expect(
      routeBumpers(upload('audio/wav', wav, 'bumpers?name=Replacement&position=intro'), env, human),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    spy.mockRestore();
  }
});

it('revalidates private category and speech snapshot references before storage deletion', async () => {
  const categoryObject = await env.MEDIA.put('uploads/category-reference.webp', 'fixture');
  const speechObject = await env.MEDIA.put('uploads/speech-reference.wav', 'fixture');
  if (!categoryObject || !speechObject) throw new Error('Fixture upload failed');
  await env.DB.prepare("UPDATE categories SET prompt=? WHERE id='manager-notes'")
    .bind(`![Reference](/media/${categoryObject.key})`)
    .run();
  await env.DB.prepare("INSERT INTO media_provenance VALUES ('reference',?)")
    .bind(JSON.stringify({ source: { key: speechObject.key } }))
    .run();
  const aged = {
    ...env,
    MEDIA: {
      head: async (key: string) => {
        const value = await env.MEDIA.head(key);
        return value ? { ...value, uploaded: new Date('2020-01-01') } : null;
      },
      delete: env.MEDIA.delete.bind(env.MEDIA),
    } as R2Bucket,
  };
  try {
    const result = await routeStorage(
      request(
        'POST',
        { items: [categoryObject, speechObject].map(({ key, version }) => ({ key, version })) },
        'storage/cleanup',
      ),
      aged,
      granted('storage:delete'),
    );
    expect(await result.json()).toMatchObject({ results: [{ status: 'skipped' }, { status: 'skipped' }] });
    expect(await env.MEDIA.head(categoryObject.key)).not.toBeNull();
    expect(await env.MEDIA.head(speechObject.key)).not.toBeNull();
  } finally {
    await env.DB.prepare("UPDATE categories SET prompt='' WHERE id='manager-notes'").run();
  }
});
