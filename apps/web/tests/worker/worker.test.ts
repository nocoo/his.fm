import { readdirSync, readFileSync } from 'node:fs';
import { scopePresets } from '@his-fm/contracts';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../../../package.json';
import { type Appearance, appearanceSchema, themeIds } from '../../src/shared/appearance';
import { channelProfileSchema } from '../../src/shared/channel';
import { type Episode, type EpisodeInput, projectPublicEpisode } from '../../src/shared/episode';
import type { Production } from '../../src/shared/production';
import worker from '../../worker';
import { productionCapabilities } from '../../worker/agent-api';
import {
  agentOpenApi,
  productionCapabilitiesSchema,
  productionResponseSchema,
  serviceCapabilitiesSchema,
  serviceManifestSchema,
} from '../../worker/agent-contract';
import { agent, brief, fixture, readyFixture } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const origin = 'https://hisfm.dev.hexly.ai';
const issuer = 'https://nocoo.cloudflareaccess.com';
const audience = '41ef6d396f8256e97999ba1d1f11e15f6e7e5e788fce46f54016fd1d9710f726';
const input: EpisodeInput = {
  slug: 'leave-a-note',
  episodeNumber: 7,
  title: '给明天留一张纸条',
  summary: '记录今天停下来的位置。',
  transcript: '今天先到这里，明天从下一步开始。',
  showNotes: '00:00 从停下来的地方继续',
  coverUrl: '/images/episode-01.webp',
  category: 'manager-notes',
  tags: ['工作节奏'],
  durationSeconds: 600,
  audioUrl: null,
  status: 'published',
  featured: false,
  publishedAt: '2026-09-01T08:00:00.000Z',
  mentions: [
    {
      name: 'his.fm',
      description: '这档播客的主站。',
      url: 'https://his.fm/',
    },
  ],
};

let miniflare: Miniflare;
let env: Env;
let privateKey: CryptoKey;
let cookie: string;

function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (cookie && !headers.has('Cookie')) headers.set('Cookie', cookie);
  if (options.method && options.method !== 'GET') headers.set('Origin', origin);
  return new Request(`${origin}${path}`, { ...options, headers });
}

function call(path: string, options: RequestInit = {}, bindings = env) {
  return worker.fetch(request(path, options), bindings);
}

function body(data: unknown) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

async function create(changes: Partial<EpisodeInput> = {}) {
  const response = await call('/admin/api/episodes', { method: 'POST', ...body({ ...input, ...changes }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { episode: Episode }).episode;
}

async function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({
    email: 'editor@example.com',
    sub: 'editor-1',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .sign(privateKey);
}

beforeAll(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'hisfm-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: 'export default { fetch() { return new Response("asset"); } }',
              },
            },
          },
          env: {
            DB: { type: 'd1', name: 'his-fm-test' },
            MEDIA: { type: 'r2', name: 'his-fm-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
            ASSETS: {
              type: 'fetcher',
              handler: () =>
                new MiniflareResponse('<html>his.fm</html>', { headers: { 'Content-Type': 'text/html' } }),
            },
          },
        },
      },
    ],
  });
  env = await miniflare.getBindings<Env>();
  const directory = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(new URL(name, directory), 'utf8')
        .split(';')
        .filter((statement) => statement.trim())
        .map((statement) => env.DB.prepare(statement)),
    );
  }
  const keyPair = await generateKeyPair('RS256', { extractable: true });
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
}, 30000);

beforeEach(async () => {
  await env.DB.batch(
    ['episodes', 'local_sessions', 'productions', 'episode_number_claims', 'agent_tokens'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  cookie = '';
  const response = await call('/admin/api/dev-login', { method: 'POST' });
  expect(response.status).toBe(200);
  cookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await miniflare?.dispose();
});

describe('public podcast catalog', () => {
  it('keeps drafts and future episodes private while exposing published content', async () => {
    const episode = await create();
    await create({ slug: 'draft', status: 'draft', publishedAt: null, episodeNumber: undefined });
    await create({ slug: 'future', publishedAt: '2999-01-01T00:00:00.000Z', episodeNumber: undefined });
    const publicEpisode = projectPublicEpisode(episode, origin);
    const list = await call('/api/episodes');
    expect(await list.json()).toEqual({ episodes: [publicEpisode] });
    expect((await call('/api/episodes/draft')).status).toBe(404);
    expect((await call('/api/episodes/future')).status).toBe(404);
    expect((await call('/api/episodes/missing')).status).toBe(404);
    expect(await (await call(`/api/episodes/${episode.slug}`)).json()).toEqual({ episode: publicEpisode });
    expect((await call('/api/episodes')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('redirects legacy episode URLs to category paths', async () => {
    const episode = await create();
    const response = await call(`/episodes/${episode.slug}`);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toContain(`/episodes/${episode.category}/${episode.slug}`);
    const head = await call(`/episodes/${episode.slug}`, { method: 'HEAD' });
    expect(head.status).toBe(301);
  });

  it('redirects reserved legacy slugs when a published episode uses them', async () => {
    const episode = await create({ slug: 'about' });
    const response = await call('/episodes/about');
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toContain(`/episodes/${episode.category}/about`);
  });

  it('updates episode number claims when renumbering manual episodes', async () => {
    const episode = await create({ episodeNumber: 2, slug: 'renumber-me' });
    const response = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...input,
        version: episode.version,
        slug: 'renumber-me',
        episodeNumber: 4,
        category: 'learning',
      }),
    });
    expect(response.status).toBe(200);
    expect(
      await env.DB.prepare(
        'SELECT category, episode_number AS episodeNumber FROM episode_number_claims WHERE holder_kind = ? AND holder_id = ?',
      )
        .bind('episode', episode.id)
        .first<{ category: string; episodeNumber: number }>(),
    ).toEqual({ category: 'learning', episodeNumber: 4 });
  });

  it('updates episodes without touching claims when number and category stay the same', async () => {
    const episode = await create({ episodeNumber: 30, slug: 'stable-number' });
    const response = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...input,
        version: episode.version,
        slug: 'stable-number',
        episodeNumber: 30,
        title: '新标题',
      }),
    });
    expect(response.status).toBe(200);
  });

  it('retries manual episode creation after claim races', async () => {
    for (let number = 1; number <= 7; number++) {
      await env.DB.prepare(
        'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
      )
        .bind(input.category, number, `holder-${number}`, 'episode')
        .run();
    }
    await env.DB.prepare(
      'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
    )
      .bind(input.category, 8, 'blocked-eight', 'episode')
      .run();
    const response = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, episodeNumber: undefined, slug: 'race-episode' }),
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { episode: Episode }).episode.episodeNumber).toBe(9);
  });

  it('does not move episode claims when a stale episode update conflicts', async () => {
    const episode = await create({ episodeNumber: 31, slug: 'stale-claim' });
    const before = await env.DB.prepare(
      'SELECT category, episode_number AS episodeNumber FROM episode_number_claims WHERE holder_kind = ? AND holder_id = ?',
    )
      .bind('episode', episode.id)
      .first<{ category: string; episodeNumber: number }>();
    const response = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({ ...input, version: 999, slug: 'stale-claim', episodeNumber: 99, category: 'learning' }),
    });
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare(
        'SELECT category, episode_number AS episodeNumber FROM episode_number_claims WHERE holder_kind = ? AND holder_id = ?',
      )
        .bind('episode', episode.id)
        .first<{ category: string; episodeNumber: number }>(),
    ).toEqual(before);
  });

  it('returns conflict when deleting a stale episode version', async () => {
    const episode = await create({
      status: 'draft',
      publishedAt: null,
      episodeNumber: 24,
      slug: 'stale-delete',
    });
    const response = await call(`/admin/api/episodes/${episode.id}?version=999`, { method: 'DELETE' });
    expect(response.status).toBe(409);
  });

  it('rejects duplicate slugs within a category when creating episodes', async () => {
    await create({ slug: 'shared-slug', episodeNumber: 22 });
    const response = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, slug: 'shared-slug', episodeNumber: 23 }),
    });
    expect(response.status).toBe(409);
  });

  it('rejects duplicate slugs within a category when updating episodes', async () => {
    await create({ slug: 'slug-a', episodeNumber: 20 });
    const second = await create({ slug: 'slug-b', episodeNumber: 21 });
    const response = await call(`/admin/api/episodes/${second.id}`, {
      method: 'PUT',
      ...body({ ...input, version: second.version, slug: 'slug-a', episodeNumber: 21 }),
    });
    expect(response.status).toBe(409);
  });

  it('rejects duplicate numbers when creating manual episodes', async () => {
    await create({ episodeNumber: 11, slug: 'first-eleven' });
    const response = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, episodeNumber: 11, slug: 'second-eleven' }),
    });
    expect(response.status).toBe(409);
  });

  it('blocks duplicate episode numbers across productions and manual episodes', async () => {
    const manual = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, slug: 'manual-one', episodeNumber: 1 }),
    });
    expect(manual.status).toBe(201);
    const duplicate = await call('/admin/api/productions', {
      method: 'POST',
      ...body({ ...brief, category: input.category, slug: 'production-one', episodeNumber: 1 }),
    });
    expect(duplicate.status).toBe(409);
  });

  it('redirects renamed category segments on nested episode URLs', async () => {
    const episode = await create();
    await env.DB.prepare('INSERT INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
      .bind('legacy-category', episode.category)
      .run();
    const response = await call(`/episodes/legacy-category/${episode.slug}`);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toContain(`/episodes/${episode.category}/${episode.slug}`);
  });

  it('resolves nested public episode API paths', async () => {
    const episode = await create();
    const nested = await call(`/api/episodes/${episode.category}/${episode.slug}`);
    expect(nested.status).toBe(200);
    const legacy = await call(`/api/episodes/${episode.slug}`);
    expect(legacy.status).toBe(200);
    expect(((await nested.json()) as { episode: Episode }).episode.slug).toBe(episode.slug);
  });

  it('exposes mentions on public episode JSON without transcript', async () => {
    const episode = await create();
    const listed = (await (await call('/api/episodes')).json()) as { episodes: Episode[] };
    expect(listed.episodes[0]?.mentions).toEqual(input.mentions);
    const detail = (await (await call(`/api/episodes/${episode.slug}`)).json()) as { episode: Episode };
    expect(detail.episode.mentions).toEqual(input.mentions);
    expect(detail.episode).not.toHaveProperty('transcript');
  });

  it('rejects duplicate manual episode numbers when creating productions', async () => {
    const first = await call('/admin/api/productions', { method: 'POST', ...body(brief) });
    expect(first.status).toBe(201);
    const duplicate = await call('/admin/api/productions', {
      method: 'POST',
      ...body({ ...brief, slug: 'another-slug', episodeNumber: brief.episodeNumber }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: '该栏目下已有相同期数' });
  });

  it('includes mentions in RSS item descriptions', async () => {
    await create();
    const feed = await call('/feed.xml');
    expect(feed.status).toBe(200);
    expect(feed.headers.get('Content-Type')).toContain('application/rss+xml');
    const xml = await feed.text();
    expect(xml).toContain('本期提到');
    expect(xml).toContain('his.fm — 这档播客的主站。');
    expect(xml).toContain('https://his.fm/');
  });

  it('omits transcript from public episode JSON while admin and agent APIs retain it', async () => {
    const episode = await create();
    expect(episode.transcript.length).toBeGreaterThan(0);
    const listed = (await (await call('/api/episodes')).json()) as { episodes: Record<string, unknown>[] };
    expect(listed.episodes[0]).not.toHaveProperty('transcript');
    const detail = (await (await call(`/api/episodes/${episode.slug}`)).json()) as {
      episode: Record<string, unknown>;
    };
    expect(detail.episode).not.toHaveProperty('transcript');
    const admin = (await (await call(`/admin/api/episodes/${episode.id}`)).json()) as { episode: Episode };
    expect(admin.episode.transcript).toBe(episode.transcript);
  });

  it('checks database liveness and handles public asset and unknown routes', async () => {
    expect(await (await call('/api/live')).json()).toEqual({
      status: 'ok',
      service: 'his.fm',
      version,
      revision: 'test-revision',
    });
    expect(await (await call('/about')).text()).toContain('his.fm');
    for (const path of ['/api/live', '/api/episodes', '/api/episodes/test']) {
      expect((await call(path, { method: 'POST' })).status).toBe(405);
    }
    expect((await call('/api/unknown')).status).toBe(404);
    expect((await call('/api')).status).toBe(404);
  });
});

describe('website appearance', () => {
  async function saved() {
    const response = await call('/admin/api/appearance');
    expect(response.status).toBe(200);
    return appearanceSchema.parse(((await response.json()) as { appearance: unknown }).appearance);
  }

  it('starts with Interval and exposes only the public theme', async () => {
    const current = await saved();
    expect(current.theme).toBe('interval');
    const response = await call('/api/appearance', { headers: { Cookie: '' } });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ appearance: { theme: 'interval' } });
  });

  it('persists all eight choices and rejects concurrent overwrites', async () => {
    let current = await saved();
    for (const theme of themeIds) {
      const response = await call('/admin/api/appearance', {
        method: 'PUT',
        ...body({ version: current.version, theme }),
      });
      expect(response.status).toBe(200);
      const next = appearanceSchema.parse(((await response.json()) as { appearance: unknown }).appearance);
      expect(next.version).toBe(current.version + 1);
      expect(next.theme).toBe(theme);
      expect(next.updatedBy).toContain('@');
      current = next;
      expect(await saved()).toEqual(current);
      expect(await (await call('/api/appearance')).json()).toEqual({ appearance: { theme } });
    }
    const responses = await Promise.all(
      ['grove', 'interval'].map((theme) =>
        call('/admin/api/appearance', {
          method: 'PUT',
          ...body({ version: current.version, theme }),
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await saved()).version).toBe(current.version + 1);
  });

  it('validates choices and versions without changing saved appearance', async () => {
    const current = await saved();
    for (const invalid of [
      { theme: 'unknown', version: current.version },
      { theme: 'grove', version: 0 },
      { theme: 'grove', version: 1.5 },
      { theme: 'grove' },
      { theme: 'grove', version: current.version, content: 'private prompt' },
    ]) {
      expect((await call('/admin/api/appearance', { method: 'PUT', ...body(invalid) })).status).toBe(400);
    }
    expect((await call('/admin/api/appearance', { method: 'DELETE' })).status).toBe(405);
    expect(await saved()).toEqual(current);
  });

  it('requires owner authentication and same-origin writes', async () => {
    const current = await saved();
    for (const method of ['GET', 'PUT']) {
      const response = await call('/admin/api/appearance', {
        method,
        headers: { Cookie: '', Authorization: 'Bearer agent-token' },
      });
      expect(response.status).toBe(401);
    }
    expect((await call('/api/appearance', { method: 'PUT', ...body(current) })).status).toBe(405);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/admin/api/appearance`, {
            method: 'PUT',
            headers: { Cookie: cookie, Origin: 'https://other.example', 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: 'grove', version: current.version }),
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(await saved()).toEqual(current);
  });

  it('reports unavailable settings without silently resetting the theme', async () => {
    const current: Appearance = await saved();
    await env.DB.prepare('DELETE FROM site_appearance').run();
    try {
      expect((await call('/api/appearance')).status).toBe(503);
      expect((await call('/admin/api/appearance')).status).toBe(503);
    } finally {
      await env.DB.prepare('INSERT INTO site_appearance VALUES (1, ?, ?, ?, ?)')
        .bind(current.version, current.theme, current.updatedAt, current.updatedBy)
        .run();
    }
  });
});

describe('editor CRUD', () => {
  it('creates, reads, edits, unpublishes and deletes a podcast in D1', async () => {
    const episode = await create();
    expect(episode.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(episode.createdAt).toBeTruthy();
    expect(await (await call('/admin/api/episodes')).json()).toEqual({ episodes: [episode] });
    expect(await (await call(`/admin/api/episodes/${episode.id}`)).json()).toEqual({ episode });
    const updated = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...input,
        version: episode.version,
        title: '今晚先到这里',
        status: 'draft',
        publishedAt: null,
        featured: true,
        audioUrl: 'https://media.his.fm/episode.mp3',
      }),
    });
    const result = (await updated.json()) as { episode: Episode };
    expect(result.episode).toMatchObject({
      id: episode.id,
      title: '今晚先到这里',
      status: 'draft',
      featured: true,
      createdAt: episode.createdAt,
    });
    expect(await (await call('/api/episodes')).json()).toEqual({ episodes: [] });
    expect(
      (
        await call(`/admin/api/episodes/${episode.id}?version=${result.episode.version}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(204);
    expect((await call(`/admin/api/episodes/${episode.id}`)).status).toBe(404);
  });

  it('does not mutate episode number claims when a stale episode save loses the race', async () => {
    const episode = await create({ status: 'draft', publishedAt: null, episodeNumber: 1 });
    const path = `/admin/api/episodes/${episode.id}`;
    const save = (version: number, title: string, episodeNumber = 1) =>
      call(path, {
        method: 'PUT',
        ...body({
          ...input,
          version,
          slug: episode.slug,
          category: episode.category,
          episodeNumber,
          status: 'draft',
          publishedAt: null,
          title,
        }),
      });
    const second = ((await (await save(episode.version, '第二版')).json()) as { episode: Episode }).episode;
    const third = ((await (await save(second.version, '第三版')).json()) as { episode: Episode }).episode;
    const before = await env.DB.prepare(
      'SELECT category, episode_number FROM episode_number_claims WHERE holder_id = ?',
    )
      .bind(episode.id)
      .all();
    expect((await save(second.version, '过期保存', 2)).status).toBe(409);
    expect(
      await env.DB.prepare('SELECT category, episode_number FROM episode_number_claims WHERE holder_id = ?')
        .bind(episode.id)
        .all(),
    ).toEqual(before);
    expect(third.episodeNumber).toBe(1);
  });

  it('rejects episode renumber when another holder already claimed the number', async () => {
    const episode = await create();
    await env.DB.prepare(
      'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
    )
      .bind(episode.category, 50, 'blocker', 'production')
      .run();
    const response = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...input,
        version: episode.version,
        category: episode.category,
        slug: episode.slug,
        episodeNumber: 50,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '该栏目下已有相同期数' });
  });

  it('enforces unique slugs and leaves existing content intact on conflicts', async () => {
    const original = await create();
    const other = await create({ slug: 'other', episodeNumber: undefined });
    const duplicate = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, episodeNumber: undefined }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: '该栏目下已有相同期数或链接名称' });
    expect(
      (
        await call(`/admin/api/episodes/${other.id}`, {
          method: 'PUT',
          ...body({ ...input, version: other.version }),
        })
      ).status,
    ).toBe(409);
    expect(
      ((await (await call(`/admin/api/episodes/${original.id}`)).json()) as { episode: Episode }).episode,
    ).toEqual(original);
  });

  it('validates bodies, immutable IDs, and published timestamps', async () => {
    for (const invalid of [
      { ...input, title: '' },
      { ...input, id: 'injected-id' },
      { ...input, publishedAt: null },
      { ...input, coverUrl: 'javascript:alert(1)' },
    ]) {
      expect((await call('/admin/api/episodes', { method: 'POST', ...body(invalid) })).status).toBe(400);
    }
    expect(
      (
        await call('/admin/api/episodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('/admin/api/episodes', { method: 'POST', headers: { 'Content-Type': 'application/json' } }))
        .status,
    ).toBe(400);
    expect((await call('/admin/api/episodes', { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await call('/admin/api/episodes', { method: 'POST' })).status).toBe(415);
  });

  it('bounds declared and streamed body sizes', async () => {
    expect(
      (
        await call('/admin/api/episodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': '600000' },
          body: '{}',
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await call('/admin/api/episodes', {
          method: 'POST',
          ...body({ ...input, transcript: 'a'.repeat(512001) }),
        })
      ).status,
    ).toBe(413);
  });

  it('rejects cross-origin changes and unsupported routes', async () => {
    const crossOrigin = new Request(`${origin}/admin/api/episodes`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect((await worker.fetch(crossOrigin, env)).status).toBe(403);
    expect((await call('/admin/api/episodes', { method: 'PATCH' })).status).toBe(405);
    expect((await call('/admin/api/episodes/no-id', { method: 'POST' })).status).toBe(405);
    expect((await call('/admin/api/episodes/no-id', { method: 'PUT', ...body(input) })).status).toBe(404);
    const episode = await create();
    expect(
      (
        await call(`/admin/api/episodes/${episode.id}`, {
          method: 'PUT',
          ...body({ ...input, title: '缺版本' }),
        })
      ).status,
    ).toBe(400);
    expect((await call('/admin/api/episodes/no-id', { method: 'DELETE' })).status).toBe(404);
    expect((await call('/admin/api/missing')).status).toBe(404);
    expect((await call('/admin/api')).status).toBe(404);
    const page = await call('/admin/episodes');
    expect(page.status).toBe(200);
    expect(page.headers.get('Cache-Control')).toBe('no-store');
  });

  it('hides unexpected storage errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await env.DB.prepare('ALTER TABLE episodes RENAME TO episodes_backup').run();
    try {
      const response = await call('/admin/api/episodes', { method: 'POST', ...body(input) });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: '暂时无法完成操作，请稍后重试' });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('request_failed'));
    } finally {
      await env.DB.prepare('ALTER TABLE episodes_backup RENAME TO episodes').run();
    }
    spy.mockRestore();
  });
});

describe('local login boundaries', () => {
  it('uses revocable hashed sessions and secure cookies', async () => {
    expect(await (await call('/admin/api/session')).json()).toEqual({
      user: { email: 'editor@his.fm', name: null, avatar: null },
      mode: 'local',
    });
    const rawToken = cookie.split('=')[1];
    const stored = await env.DB.prepare('SELECT token_hash FROM local_sessions').first<{
      token_hash: string;
    }>();
    expect(stored?.token_hash).not.toBe(rawToken);
    expect(stored?.token_hash).toHaveLength(64);
    const login = await call('/admin/api/dev-login', { method: 'POST' });
    expect(login.headers.get('Set-Cookie')).toContain('HttpOnly; SameSite=Strict; Max-Age=28800; Secure');
    const response = await call('/admin/api/logout', { method: 'POST' });
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await response.json()).toEqual({ redirect: '/admin' });
    expect((await call('/admin/api/session')).status).toBe(401);
  });

  it('rejects absent, forged, expired sessions and login CSRF', async () => {
    cookie = '';
    expect((await call('/admin/api/session')).status).toBe(401);
    expect((await call('/admin')).status).toBe(200);
    cookie = 'unrelated=1; hisfm_local_session=forged';
    expect((await call('/admin/api/session')).status).toBe(401);
    const login = await call('/admin/api/dev-login', { method: 'POST' });
    cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    await env.DB.prepare('UPDATE local_sessions SET expires_at = 0').run();
    expect((await call('/admin/api/session')).status).toBe(401);
    const invalid = new Request(`${origin}/admin/api/dev-login`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect((await worker.fetch(invalid, env)).status).toBe(403);
  });

  it('allows loopback development without Secure on HTTP and denies remote hosts', async () => {
    const local = new Request('http://127.0.0.1:7057/admin/api/dev-login', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:7057' },
    });
    const login = await worker.fetch(local, env);
    expect(login.status).toBe(200);
    expect(login.headers.get('Set-Cookie')).not.toContain('; Secure');
    for (const host of ['his.fm', 'hisfm.dev.hexly.ai.evil.example']) {
      const remote = new Request(`https://${host}/admin/api/dev-login`, {
        method: 'POST',
        headers: { Origin: `https://${host}` },
      });
      expect((await worker.fetch(remote, env)).status).toBe(404);
    }
    expect(
      (await call('/admin/api/dev-login', { method: 'POST' }, { ...env, ENVIRONMENT: 'production' })).status,
    ).toBe(404);
  });
});

describe('Cloudflare Access verification', () => {
  it('accepts a signed identity, then routes logout through Access', async () => {
    const production = { ...env, ENVIRONMENT: 'production' };
    const headers = { 'Cf-Access-Jwt-Assertion': await token() };
    const session = await call('/admin/api/session', { headers }, production);
    expect(await session.json()).toEqual({
      user: { email: 'editor@example.com', name: null, avatar: null },
      mode: 'access',
    });
    expect(await (await call('/admin/api/logout', { method: 'POST', headers }, production)).json()).toEqual({
      redirect: '/cdn-cgi/access/logout',
    });
  });

  it('fails closed for missing or invalid JWT claims and never trusts an email header', async () => {
    const production = { ...env, ENVIRONMENT: 'production' };
    for (const jwt of [
      '',
      'not-a-jwt',
      await token({ exp: 1 }),
      await token({ exp: undefined }),
      await token({ email: undefined }),
      await token({ email: '  ' }),
      await token({ email: 42 }),
      await token({ sub: undefined }),
    ]) {
      expect(
        (
          await call(
            '/admin/api/session',
            {
              headers: {
                'Cf-Access-Jwt-Assertion': jwt,
                'Cf-Access-Authenticated-User-Email': 'owner@his.fm',
              },
            },
            production,
          )
        ).status,
      ).toBe(401);
    }
    const wrongAudience = await new SignJWT({ email: 'owner@his.fm', sub: 'owner' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience('another-app')
      .setExpirationTime('5m')
      .sign(privateKey);
    const wrongIssuer = await new SignJWT({ email: 'owner@his.fm', sub: 'owner' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://another.cloudflareaccess.com')
      .setAudience(audience)
      .setExpirationTime('5m')
      .sign(privateKey);
    for (const jwt of [wrongAudience, wrongIssuer]) {
      expect(
        (await call('/admin/api/episodes', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }, production))
          .status,
      ).toBe(401);
    }
    for (const path of ['/admin', '/admin/episodes', '/admin/unknown']) {
      const page = await call(path, {}, production);
      expect(page.status).toBe(302);
      expect(page.headers.get('Location')).toContain(
        'https://nocoo.cloudflareaccess.com/cdn-cgi/access/login/his.fm',
      );
    }
  });
});

describe('R2 media', () => {
  it('streams content with metadata, cache headers and conditional requests', async () => {
    await env.MEDIA.put('covers/test.webp', 'image-content', { httpMetadata: { contentType: 'image/webp' } });
    const response = await call('/media/covers/test.webp');
    expect(await response.text()).toBe('image-content');
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(
      (
        await call('/media/covers/test.webp', {
          headers: { 'If-None-Match': response.headers.get('ETag') ?? '' },
        })
      ).status,
    ).toBe(304);
    expect(await (await call('/media/covers/test.webp', { method: 'HEAD' })).text()).toBe('');
  });

  it('rejects absent or invalid media keys and methods', async () => {
    expect((await call('/media/missing')).status).toBe(404);
    expect((await call('/media/')).status).toBe(404);
    expect((await call('/media/test..webp')).status).toBe(404);
    expect((await call('/media/%00')).status).toBe(404);
    expect((await call('/media/test.webp', { method: 'POST' })).status).toBe(405);
  });
});

describe('agent discovery and real bearer routing', () => {
  it('persists owner positioning, protects private content and injects the latest revision into all tasks', async () => {
    await env.DB.prepare('DELETE FROM channel_profile').run();
    const initial = channelProfileSchema.parse(
      ((await (await call('/admin/api/channel')).json()) as { channel: unknown }).channel,
    );
    expect(initial.version).toBe(1);
    for (const phrase of [
      '年轻程序员',
      'well-being',
      '不谄媚',
      '政治',
      '未成年人',
      '单人播讲',
      '复述这些原则',
    ])
      expect(initial.content).toContain(phrase);
    expect((await call('/api/agent/channel')).status).toBe(401);
    const secret = (await (
      await call('/admin/api/agent-tokens', {
        method: 'POST',
        ...body({
          name: 'Channel reader',
          expiresInDays: 1,
          scopes: ['productions:read', 'categories:read', 'prompts:read'],
        }),
      })
    ).json()) as { token: string };
    const agentCall = (path: string, options: RequestInit = {}) =>
      worker.fetch(
        new Request(`${origin}/api/agent${path}`, {
          ...options,
          headers: { ...options.headers, Authorization: `Bearer ${secret.token}` },
        }),
        env,
      );
    expect(await (await agentCall('/channel')).json()).toEqual({
      channel: initial,
      priority: ['channel', 'category', 'intent', 'sources'],
    });
    expect(
      (await agentCall('/channel', { method: 'PUT', ...body({ version: 1, content: 'Injected change' }) }))
        .status,
    ).toBe(403);
    for (const method of ['POST', 'DELETE'])
      expect((await agentCall('/channel', { method })).status).toBe(405);
    const changed = await call('/admin/api/channel', {
      method: 'PUT',
      ...body({ version: initial.version, content: '## 新的全局提示词\n\n自定义定位：从下班后的生活切入。' }),
    });
    expect(changed.status).toBe(200);
    const profile = channelProfileSchema.parse(((await changed.json()) as { channel: unknown }).channel);
    expect(profile.version).toBe(2);
    expect(profile.updatedBy).toBe('editor@his.fm');
    expect(((await (await call('/admin/api/channel')).json()) as { channel: unknown }).channel).toEqual(
      profile,
    );
    expect(
      (await call('/admin/api/channel', { method: 'PUT', ...body({ version: 1, content: 'Stale version' }) }))
        .status,
    ).toBe(409);
    for (const content of ['', ' ', 'x'.repeat(30001)])
      expect(
        (await call('/admin/api/channel', { method: 'PUT', ...body({ version: 2, content }) })).status,
      ).toBe(400);
    expect((await call('/admin/api/channel', { method: 'DELETE' })).status).toBe(405);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/admin/api/channel`, {
            method: 'PUT',
            headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: 2, content: 'Forged' }),
          }),
          env,
        )
      ).status,
    ).toBe(403);
    const created = (await (
      await call('/admin/api/productions', { method: 'POST', ...body(brief) })
    ).json()) as {
      production: Production;
    };
    const prompts = (await (
      await agentCall(`/productions/${created.production.id}/prompts`)
    ).json()) as Record<string, string>;
    for (const prompt of Object.values(prompts)) {
      expect(prompt).toContain('自定义定位');
      expect(prompt).toContain('"version": 2');
      expect(prompt).not.toContain('有温度，有柔情');
      expect(prompt.indexOf('自定义定位')).toBeLessThan(prompt.indexOf('"intent"'));
    }
    expect(
      (
        (await (await agentCall(`/productions/${created.production.id}`)).json()) as {
          production: Production;
        }
      ).production,
    ).toEqual(created.production);
    for (const path of [
      '/api/agent',
      '/api/agent/instructions',
      '/api/agent/openapi.json',
      '/llms.txt',
      '/.well-known/api-catalog',
    ])
      expect(await (await call(path)).text()).not.toContain('自定义定位');
    expect(await (await agentCall('/capabilities')).json()).toMatchObject({
      editorial: {
        priority: ['channel', 'category', 'intent', 'sources'],
        channelUrl: `${origin}/api/agent/channel`,
        readBeforeEveryTask: true,
      },
    });
    const edited = { ...profile.prompts, coordinator: '主控自定义私有标记', script: '逐字稿自定义私有标记' };
    const updated = await call('/admin/api/channel', {
      method: 'PUT',
      ...body({ version: profile.version, prompts: edited }),
    });
    expect(updated.status).toBe(200);
    const saved = channelProfileSchema.parse(((await updated.json()) as { channel: unknown }).channel);
    expect(saved.content).toBe(profile.content);
    expect(saved.prompts).toEqual(edited);
    expect(saved.version).toBe(profile.version + 1);
    expect(((await (await agentCall('/channel')).json()) as { channel: unknown }).channel).toEqual(saved);
    expect(await (await agentCall(`/productions/${created.production.id}/prompts`)).text()).toContain(
      '逐字稿自定义私有标记',
    );
    expect(((await (await call('/admin/api/channel')).json()) as { channel: unknown }).channel).toEqual(
      saved,
    );
    expect(
      (await agentCall('/channel', { method: 'PUT', ...body({ version: saved.version, prompts: edited }) }))
        .status,
    ).toBe(403);
    for (const invalid of [
      { version: saved.version },
      { version: saved.version, prompts: {} },
      { version: saved.version, prompts: { ...edited, speech: '' } },
      { version: saved.version, prompts: { ...edited, decisionPlan: '中'.repeat(1501) } },
    ]) {
      expect((await call('/admin/api/channel', { method: 'PUT', ...body(invalid) })).status).toBe(400);
    }
    expect(
      (
        await call('/admin/api/channel', {
          method: 'PUT',
          ...body({ version: profile.version, prompts: edited }),
        })
      ).status,
    ).toBe(409);
    for (const path of [
      '/api/agent',
      '/api/agent/openapi.json',
      '/llms.txt',
      '/api/categories',
      '/api/episodes',
    ]) {
      expect(await (await call(path)).text()).not.toContain('自定义私有标记');
    }
    await env.DB.prepare('UPDATE channel_profile SET prompts = NULL WHERE id = 1').run();
    const initialized = channelProfileSchema.parse(
      ((await (await call('/admin/api/channel')).json()) as { channel: unknown }).channel,
    );
    expect(initialized.content).toBe(saved.content);
    expect(initialized.version).toBe(saved.version + 1);
    expect(((await (await call('/admin/api/channel')).json()) as { channel: unknown }).channel).toEqual(
      initialized,
    );
    await env.DB.prepare('DELETE FROM channel_profile').run();
  });
  it('serves the advertised root, RFC catalog, OpenAPI and instructions without exposing private records', async () => {
    for (const path of [
      '/api/agent',
      '/api/agent/',
      '/api/agent/openapi.json',
      '/api/agent/instructions',
      '/.well-known/api-catalog',
      '/llms.txt',
    ]) {
      const response = await call(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('Link')).toContain('rel="service-desc"');
      expect(response.headers.get('Content-Type')).not.toContain('text/html');
      expect(await (await call(path, { method: 'HEAD' })).text()).toBe('');
      expect((await call(path, { method: 'OPTIONS' })).headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
      expect((await call(path, { method: 'POST' })).status).toBe(405);
    }
    const manifest = serviceManifestSchema.parse(await (await call('/api/agent')).json());
    expect(manifest).toMatchObject({ protocol: 'REST', api: `${origin}/api/agent`, version });
    const catalog = await call('/.well-known/api-catalog');
    expect(catalog.headers.get('Content-Type')).toBe('application/linkset+json');
    expect(await catalog.json()).toMatchObject({
      linkset: [
        { anchor: `${origin}/api/agent`, 'service-desc': [{ href: `${origin}/api/agent/openapi.json` }] },
      ],
    });
    expect(await (await call('/api/agent/openapi.json')).json()).toEqual(agentOpenApi(origin));
    const instructions = await (await call('/api/agent/instructions')).text();
    expect(instructions).toContain('External clients create text, artwork and recordings outside the site');
    expect(instructions).toContain('productions:approve');
    expect(instructions).not.toContain('X-Hisfm-Station');
    expect(instructions).not.toContain('/api/agent/runtime/connect');
    expect(instructions).not.toContain('https://his.fm');
    const unauthorized = await call('/api/agent/me');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(await unauthorized.json()).toMatchObject({
      code: 'unauthorized',
      documentation: `${origin}/api/agent/instructions`,
    });
    for (const path of [
      '/api/agent/productions',
      '/api/agent/capabilities',
      '/api/agent/productions/private/capabilities',
    ]) {
      expect((await call(path)).status).toBe(401);
    }
  });

  it('manages scoped productions over REST without requiring a resident station', async () => {
    const tokenResponse = await call('/admin/api/agent-tokens', {
      method: 'POST',
      ...body({
        name: 'Hermes integration',
        expiresInDays: 1,
        scopes: [...scopePresets.editor, 'productions:delete', 'storage:write'],
      }),
    });
    const secret = (await tokenResponse.json()) as { token: string; record: { id: string } };
    const agentCall = (path: string, options: RequestInit = {}, bindings = env) => {
      const headers = new Headers(options.headers);
      headers.set('Authorization', `bearer ${secret.token}`);
      return worker.fetch(new Request(`${origin}/api/agent${path}`, { ...options, headers }), bindings);
    };
    expect(await (await agentCall('/me')).json()).toMatchObject({
      actor: { kind: 'agent', name: expect.stringContaining('Hermes integration') },
    });
    const capabilities = serviceCapabilitiesSchema.parse(await (await agentCall('/capabilities')).json());
    expect(capabilities.audio).toEqual({
      execution: 'external',
      uploadMimeTypes: ['audio/wav', 'audio/mpeg'],
      maximumSeconds: 3600,
      maximumBytes: 172865536,
      maximumMp3Bytes: 144065536,
    });
    expect((await agentCall('/me', { method: 'POST' })).status).toBe(405);
    expect((await agentCall('/me', { method: 'POST' })).headers.get('Allow')).toBe('GET');
    expect((await agentCall('/productions', { method: 'PATCH' })).status).toBe(405);
    const created = await agentCall('/productions', { method: 'POST', ...body(brief) });
    expect(created.status).toBe(201);
    const p = productionResponseSchema.parse(((await created.json()) as { production: unknown }).production);
    expect((await agentCall('/productions/')).status).toBe(200);
    expect(await (await agentCall(`/productions/${p.id}`)).json()).toMatchObject({
      production: p,
      categoryProfile: { id: p.category },
    });
    expect(await (await agentCall(`/productions/${p.id}/prompts`)).json()).toMatchObject({
      brief: expect.any(String),
      script: expect.any(String),
      cover: expect.any(String),
      description: expect.any(String),
    });
    const before = productionCapabilitiesSchema.parse(
      await (await agentCall(`/productions/${p.id}/capabilities`)).json(),
    );
    expect(before.availableActions).toEqual(['submit_brief']);
    expect(before.editableFields).toContain('intent');
    expect(
      (
        await agentCall(`/productions/${p.id}`, {
          method: 'PUT',
          ...body({ version: 999, intent: 'Conflict' }),
        })
      ).status,
    ).toBe(409);
    const changed = await agentCall(`/productions/${p.id}`, {
      method: 'PUT',
      ...body({ version: p.version, intent: 'Scoped REST edit' }),
    });
    expect(changed.status).toBe(200);
    const edited = ((await changed.json()) as { production: Production }).production;
    expect(edited.events.at(-1)?.actor).toMatchObject({ kind: 'agent', tokenId: secret.record.id });
    const submitted = await agentCall(`/productions/${p.id}/actions`, {
      method: 'POST',
      ...body({ version: edited.version, action: 'submit_brief' }),
    });
    expect(submitted.status).toBe(200);
    const review = ((await submitted.json()) as { production: Production }).production;
    expect(review.stage).toBe('brief_review');
    expect(
      (
        await agentCall(`/productions/${p.id}/actions`, {
          method: 'POST',
          ...body({ version: review.version, action: 'approve_brief' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await agentCall(`/productions/${p.id}/assets/cover?version=${review.version}`, {
          method: 'PUT',
          ...body({}),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await agentCall(`/productions/${p.id}/audio`, {
          method: 'POST',
          ...body({ version: review.version }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await agentCall(`/productions/${p.id}/publications`, { method: 'POST', ...body({}) })).status,
    ).toBe(403);
    expect((await agentCall('/production-settings')).status).toBe(404);
    expect((await agentCall('/unknown')).status).toBe(404);
    expect((await agentCall('/productions/missing/capabilities')).status).toBe(404);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await env.DB.prepare('ALTER TABLE productions RENAME TO productions_backup').run();
    try {
      const failure = await agentCall('/productions');
      expect(failure.status).toBe(500);
      expect(failure.headers.get('Link')).toContain('service-desc');
      expect(await failure.json()).toEqual({
        error: '暂时无法完成操作，请稍后重试',
        code: 'internal_error',
        documentation: `${origin}/api/agent/instructions`,
      });
    } finally {
      await env.DB.prepare('ALTER TABLE productions_backup RENAME TO productions').run();
      log.mockRestore();
    }
    expect(
      (await agentCall(`/productions/${p.id}?version=${review.version}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect((await agentCall(`/productions/${p.id}`)).status).toBe(404);
    await call(`/admin/api/agent-tokens/${secret.record.id}/revoke`, { method: 'POST' });
    expect((await agentCall('/me')).status).toBe(401);
  });

  it('derives action availability from the real state machine without mutating records', () => {
    const ready = readyFixture({ stage: 'production' });
    const copy = structuredClone(ready);
    expect(productionCapabilities(ready, agent, origin)).toMatchObject({
      availableActions: ['submit_final'],
      canUploadAudio: false,
    });
    expect(ready).toEqual(copy);
    expect(productionCapabilities(fixture(), agent, origin).blockedActions.submit_brief).toBeUndefined();
    expect(productionCapabilities(fixture({ sources: [] }), agent, origin).availableActions).toEqual([]);
    expect(
      productionCapabilities(
        readyFixture({
          publications: [
            {
              platform: 'wechat',
              url: 'https://mp.weixin.qq.com/s/a',
              publishedAt: '2026-01-01',
              confirmedAt: '2026-01-01',
              confirmedBy: 'Owner',
              version: 1,
            },
          ],
        }),
        agent,
        origin,
      ).canDelete,
    ).toBe(false);
  });
});
