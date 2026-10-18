import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, EpisodeInput } from '../../src/shared/episode';
import type { Production } from '../../src/shared/production';
import worker from '../../worker';
import { routeAgentTokens } from '../../worker/agent-tokens';
import { ensureEpisodeArt } from '../../worker/episode-art';
import * as pregeneration from '../../worker/episode-art-pregenerate';
import { routeManagement } from '../../worker/management';
import { fixture, human, readyFixture } from './production-fixture';

vi.mock('../../worker/episode-art', () => ({
  episodeArtRoute: /^\/episodes\/([^/]+)\/(art|share)\.jpg$/,
  routeEpisodeArt: vi.fn(),
  ensureEpisodeArt: vi.fn(),
}));
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const origin = 'https://hisfm.dev.hexly.ai';
const episodeInput: EpisodeInput = {
  slug: 'standalone',
  episodeNumber: 10,
  title: '独立节目',
  summary: '今晚好好吃饭',
  transcript: '',
  showNotes: '',
  coverUrl: '/images/episode-01.webp',
  category: 'life',
  tags: [],
  mentions: [],
  seo: {},
  durationSeconds: 0,
  audioUrl: null,
  status: 'draft',
  featured: false,
  publishedAt: null,
};
let mf: Miniflare;
let env: Env;
let cookie: string;
const ensure = vi.mocked(ensureEpisodeArt);

function request(path: string, method = 'GET', data?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
function management(path: string, method = 'GET', data?: unknown, ctx?: ExecutionContext) {
  return routeManagement(request(path, method, data), env, path.split('?')[0], human, ctx);
}
async function insert(production: Production) {
  await env.DB.prepare('INSERT INTO productions VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      production.id,
      production.version,
      production.stage,
      JSON.stringify(production),
      production.createdAt,
      production.updatedAt,
      crypto.randomUUID(),
    )
    .run();
}
async function insertEpisode(id: string, category = 'life', source: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, status, created_at, updated_at, source_production_id)
    VALUES (?, ?, ?, ?, '', '', '', '/images/episode-01.webp', ?, 'draft', 'now', 'now', ?)`,
  )
    .bind(id, id, source ? 8 : 10, id, category, source)
    .run();
}
function rendered() {
  return ensure.mock.calls.map(([, , record, theme]) => [record.resource, record.id, theme]);
}
async function success(path: string, method: string, data: unknown) {
  const response = await management(path, method, data);
  expect(response?.status, await response?.clone().text()).toBe(200);
  return response as Response;
}

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'episode-art-pregenerate-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'episode-art-pregenerate-test' },
            MEDIA: { type: 'r2', name: 'episode-art-pregenerate-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
            MEDIA_BASE_URL: { type: 'json', value: 'https://f.no.mt' },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  for (const file of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(`migrations/${file}`, 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
  }
});
beforeEach(async () => {
  ensure.mockReset().mockResolvedValue({ object: {} as R2Object, source: 'rendered' });
  await env.DB.batch(
    ['episodes', 'productions', 'episode_number_claims', 'agent_tokens', 'local_sessions'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await env.DB.batch([
    env.DB.prepare("UPDATE site_appearance SET theme = 'stillwood', version = 1"),
    env.DB.prepare("UPDATE categories SET name = '生活', version = 1 WHERE id = 'life'"),
  ]);
  const response = await worker.fetch(request('/admin/api/dev-login', 'POST'), env);
  expect(response.status).toBe(200);
  cookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => mf.dispose());

describe('artwork pregeneration selection and failures', () => {
  beforeEach(async () => {
    await insert(readyFixture());
    await insert(fixture({ id: 'no-cover', episodeNumber: 9 }));
    await insert(readyFixture({ id: 'work-production', category: 'learning' }));
    await insertEpisode('linked', 'life', 'production-test');
    await insertEpisode('standalone');
    await insertEpisode('work-episode', 'learning');
  });

  it.each([
    '/productions/production-test',
    '/productions/production-test/actions',
    '/productions/production-test/assets/cover',
    '/productions/production-test/publications',
    '/productions/production-test/publications/site',
    '/productions/production-test/publications/wechat',
    '/productions/production-test/publications/xiaoyuzhou',
  ])('renders both variants for a production and only its linked episodes after %s', async (path) => {
    await pregeneration.pregenerateEpisodeArt(env, origin, path);
    expect(rendered()).toEqual([
      ['productions', 'production-test', 'stillwood'],
      ['productions', 'production-test', null],
      ['episodes', 'linked', 'stillwood'],
      ['episodes', 'linked', null],
    ]);
    expect(ensure.mock.calls.every(([bindings, url]) => bindings === env && url === origin)).toBe(true);
  });

  it('renders only the selected standalone episode, or every episode after collection creation', async () => {
    await pregeneration.pregenerateEpisodeArt(env, origin, '/episodes/standalone');
    expect(rendered()).toEqual([
      ['episodes', 'standalone', 'stillwood'],
      ['episodes', 'standalone', null],
    ]);
    ensure.mockClear();
    await pregeneration.pregenerateEpisodeArt(env, origin, '/episodes');
    expect(ensure).toHaveBeenCalledTimes(6);
    expect(new Set(ensure.mock.calls.map(([, , record]) => record.id))).toEqual(
      new Set(['standalone', 'linked', 'work-episode']),
    );
  });

  it('renders both resource types only in the renamed category', async () => {
    await env.DB.prepare("UPDATE categories SET name = '新栏目' WHERE id = 'life'").run();
    await pregeneration.pregenerateEpisodeArt(env, origin, '/categories/life');
    expect(ensure).toHaveBeenCalledTimes(6);
    expect(ensure.mock.calls.every(([, , record]) => record.categoryName === '新栏目')).toBe(true);
    expect(new Set(ensure.mock.calls.map(([, , record]) => record.resource))).toEqual(
      new Set(['episodes', 'productions']),
    );
  });

  it('regenerates every current square after a theme change, without regenerating unchanged share images', async () => {
    await env.DB.prepare("UPDATE site_appearance SET theme = 'interval'").run();
    await pregeneration.pregenerateEpisodeArt(env, origin, '/appearance');
    expect(ensure).toHaveBeenCalledTimes(5);
    expect(ensure.mock.calls.every(([, , , theme]) => theme === 'interval')).toBe(true);
    expect(new Set(ensure.mock.calls.map(([, , record]) => record.id))).toEqual(
      new Set(['production-test', 'work-production', 'linked', 'standalone', 'work-episode']),
    );
  });

  it.each([
    '/channel',
    '/productions',
    '/productions/production-test/assets/audio',
    '/productions/production-test/publications/unknown',
    '/productions/missing',
    '/episodes/missing',
    '/categories/missing',
  ])('does not render for unrelated paths or missing records: %s', async (path) => {
    await pregeneration.pregenerateEpisodeArt(env, origin, path);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('continues subsequent variants and records when rendering fails and logs bounded context', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    ensure.mockRejectedValueOnce(new Error('Renderer busy')).mockRejectedValueOnce('untyped failure');
    await pregeneration.pregenerateEpisodeArt(env, origin, '/categories/life');
    expect(ensure).toHaveBeenCalledTimes(6);
    expect(log.mock.calls.map(([value]) => JSON.parse(String(value)))).toEqual([
      {
        event: 'episode_art_pregeneration_failed',
        resource: 'episodes',
        id: 'linked',
        variant: 'stillwood',
        message: 'Renderer busy',
      },
      {
        event: 'episode_art_pregeneration_failed',
        resource: 'episodes',
        id: 'linked',
        variant: 'share',
        message: 'Unknown error',
      },
    ]);
  });

  it.each([new Error('D1 unavailable'), 'untyped failure'])(
    'logs lookup failures without rejecting successful mutations',
    async (error) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const bindings = {
        ...env,
        DB: {
          prepare: () => {
            throw error;
          },
        } as unknown as D1Database,
      };
      await expect(
        pregeneration.pregenerateEpisodeArt(bindings, origin, '/appearance'),
      ).resolves.toBeUndefined();
      expect(ensure).not.toHaveBeenCalled();
      expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
        event: 'episode_art_pregeneration_failed',
        path: '/appearance',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  );
});

describe('successful shared management mutations trigger pregeneration', () => {
  it.each(['admin', 'agent'] as const)(
    'uses the same awaited pregeneration path for %s cover uploads',
    async (client) => {
      await insert(readyFixture({ stage: 'production' }));
      const spy = vi.spyOn(pregeneration, 'pregenerateEpisodeArt');
      const headers: Record<string, string> = { 'Content-Type': 'image/png' };
      if (client === 'admin') {
        headers.Cookie = cookie;
        headers.Origin = origin;
      } else {
        const response = await routeAgentTokens(
          request('/agent-tokens', 'POST', {
            name: 'Artwork fixture',
            scopes: ['productions:write', 'storage:write'],
            expiresInDays: 1,
          }),
          env,
          '/agent-tokens',
          human,
        );
        expect(response.status).toBe(201);
        headers.Authorization = `Bearer ${((await response.json()) as { token: string }).token}`;
      }
      const path = '/productions/production-test/assets/cover';
      const prefix = client === 'admin' ? '/admin/api' : '/api/agent';
      const response = await worker.fetch(
        new Request(`${origin}${prefix}${path}?version=1`, {
          method: 'PUT',
          headers,
          body: readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
        }),
        env,
      );
      expect(response.status, await response.clone().text()).toBe(415);
      expect(spy).not.toHaveBeenCalled();
      const uploaded = await worker.fetch(
        new Request(`${origin}${prefix}${path}?version=1`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'image/webp' },
          body: readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
        }),
        env,
      );
      expect(uploaded.status, await uploaded.clone().text()).toBe(200);
      expect(spy).toHaveBeenCalledExactlyOnceWith(env, origin, path);
      expect(rendered()).toEqual([
        ['productions', 'production-test', 'stillwood'],
        ['productions', 'production-test', null],
      ]);
      const cover = ensure.mock.calls[0][2].coverUrl;
      expect(cover).toMatch(/^\/media\/productions\/production-test\/cover-1-.+\.webp$/);
    },
  );

  it('uses freshly saved production title, number and category metadata', async () => {
    await insert(readyFixture());
    await success('/productions/production-test', 'PUT', {
      version: 1,
      title: '新标题',
      episodeNumber: 12,
      category: 'learning',
    });
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure.mock.calls[0][2]).toMatchObject({
      title: '新标题',
      episodeNumber: 12,
      resource: 'productions',
    });
    const category = await env.DB.prepare("SELECT name FROM categories WHERE id = 'learning'").first<{
      name: string;
    }>();
    expect(ensure.mock.calls[0][2].categoryName).toBe(category?.name);
  });

  it('pregenerates freshly saved image inputs from atomic action changes', async () => {
    await insert(readyFixture());
    await success('/productions/production-test/actions', 'POST', {
      version: 1,
      action: 'submit_brief',
      changes: { title: '新选题标题', episodeNumber: 21, category: 'learning' },
    });
    expect(rendered()).toEqual([
      ['productions', 'production-test', 'stillwood'],
      ['productions', 'production-test', null],
    ]);
    expect(ensure.mock.calls[0][2]).toMatchObject({
      title: '新选题标题',
      episodeNumber: 21,
      coverUrl: 'https://f.no.mt/cover.png',
    });
    const category = await env.DB.prepare("SELECT name FROM categories WHERE id = 'learning'").first<{
      name: string;
    }>();
    expect(ensure.mock.calls[0][2].categoryName).toBe(category?.name);
  });

  it('pregenerates publication snapshots after publish and explicit site republication', async () => {
    await insert(readyFixture());
    const path = '/productions/production-test';
    const publication = { platform: 'site', publishedAt: '2020-01-01T00:00:00.000Z' };
    await success(`${path}/publications`, 'POST', { ...publication, version: 1 });
    expect(rendered()).toEqual([
      ['productions', 'production-test', 'stillwood'],
      ['productions', 'production-test', null],
      ['episodes', 'production-test', 'stillwood'],
      ['episodes', 'production-test', null],
    ]);
    ensure.mockClear();
    await success(`${path}/publications/site`, 'PATCH', { ...publication, version: 2 });
    expect(ensure).toHaveBeenCalledTimes(4);
    expect(ensure.mock.calls[2][2]).toMatchObject({
      resource: 'episodes',
      coverUrl: 'https://f.no.mt/cover.png',
    });
  });

  it.each(['wechat', 'xiaoyuzhou'] as const)(
    'pregenerates the revised cover snapshot after %s correction',
    async (platform) => {
      await insert(readyFixture());
      const path = '/productions/production-test';
      const publication = {
        platform,
        url:
          platform === 'wechat'
            ? 'https://mp.weixin.qq.com/s/example'
            : 'https://www.xiaoyuzhoufm.com/episode/example',
        publishedAt: '2020-01-01T00:00:00.000Z',
      };
      await success(`${path}/publications`, 'POST', { ...publication, version: 1 });
      const upload = await routeManagement(
        new Request(`${origin}${path}/assets/cover?version=2`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/webp' },
          body: readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
        }),
        env,
        `${path}/assets/cover`,
        human,
      );
      expect(upload?.status).toBe(200);
      if (!upload) throw new Error('Missing upload response');
      let production = ((await upload.json()) as { production: Production }).production;
      const coverUrl = production.assets.cover?.url;
      expect(coverUrl).not.toBe('https://f.no.mt/cover.png');
      for (const action of ['submit_final', 'approve_final']) {
        const response = await success(`${path}/actions`, 'POST', { version: production.version, action });
        production = ((await response.json()) as { production: Production }).production;
      }
      expect(
        await env.DB.prepare("SELECT cover_url FROM episodes WHERE id = 'production-test'").first(),
      ).toEqual({ cover_url: 'https://f.no.mt/cover.png' });
      ensure.mockClear();
      await success(`${path}/publications/${platform}`, 'PATCH', {
        ...publication,
        version: production.version,
      });
      expect(rendered()).toEqual([
        ['productions', 'production-test', 'stillwood'],
        ['productions', 'production-test', null],
        ['episodes', 'production-test', 'stillwood'],
        ['episodes', 'production-test', null],
      ]);
      expect(ensure.mock.calls.every(([, , record]) => record.coverUrl === coverUrl)).toBe(true);
      expect(
        await env.DB.prepare("SELECT cover_url FROM episodes WHERE id = 'production-test'").first(),
      ).toEqual({ cover_url: coverUrl });
    },
  );

  it('pregenerates standalone episode create/update, category display rename and saved theme changes', async () => {
    const created = await management('/episodes', 'POST', episodeInput);
    expect(created?.status).toBe(201);
    if (!created) throw new Error('Missing episode response');
    const episode = ((await created.json()) as { episode: Episode }).episode;
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure.mock.calls[0][2]).toMatchObject({ id: episode.id, title: episodeInput.title });
    ensure.mockClear();
    await success(`/episodes/${episode.id}`, 'PUT', {
      ...episodeInput,
      version: 1,
      title: '保存后的标题',
      coverUrl: '/images/episode-02.webp',
    });
    expect(ensure.mock.calls[0][2]).toMatchObject({
      title: '保存后的标题',
      coverUrl: '/images/episode-02.webp',
    });
    ensure.mockClear();
    await success('/categories/life', 'PUT', { version: 1, name: '慢生活' });
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure.mock.calls[0][2].categoryName).toBe('慢生活');
    ensure.mockClear();
    await success('/appearance', 'PUT', { version: 1, theme: 'interval' });
    expect(rendered()).toEqual([['episodes', episode.id, 'interval']]);
  });

  it('uses the saved category ID after PUT renames both its ID and display name', async () => {
    await env.DB.prepare(
      "INSERT INTO categories (id, name, icon, color, updated_at, updated_by) VALUES ('rename-source', '原栏目', 'leaf', 'amber', 'now', 'owner')",
    ).run();
    await insert(readyFixture({ category: 'rename-source' }));
    await insertEpisode('renamed-episode', 'rename-source');
    const spy = vi.spyOn(pregeneration, 'pregenerateEpisodeArt');
    const input = { version: 1, nextId: 'slow-life', name: '慢生活' };
    await expect(management('/categories/rename-source', 'PATCH', input)).rejects.toMatchObject({
      status: 405,
    });
    expect(spy).not.toHaveBeenCalled();
    const response = await success('/categories/rename-source', 'PUT', input);
    expect(await response.json()).toMatchObject({ category: { id: 'slow-life', name: '慢生活' } });
    expect(spy).toHaveBeenCalledExactlyOnceWith(env, origin, '/categories/slow-life');
    expect(rendered()).toEqual([
      ['episodes', 'renamed-episode', 'stillwood'],
      ['episodes', 'renamed-episode', null],
      ['productions', 'production-test', 'stillwood'],
      ['productions', 'production-test', null],
    ]);
    expect(ensure.mock.calls.every(([, , record]) => record.categoryName === '慢生活')).toBe(true);
    expect(
      await env.DB.prepare("SELECT category FROM episodes WHERE id = 'renamed-episode'").first(),
    ).toEqual({ category: 'slow-life' });
    expect(
      await env.DB.prepare(
        "SELECT json_extract(data, '$.category') AS category FROM productions WHERE id = 'production-test'",
      ).first(),
    ).toEqual({ category: 'slow-life' });
  });

  it('does not pregenerate for reads, deletes, missing routes or rejected writes', async () => {
    await insert(readyFixture());
    await insertEpisode('standalone');
    const spy = vi.spyOn(pregeneration, 'pregenerateEpisodeArt');
    expect((await management('/productions/production-test'))?.status).toBe(200);
    expect((await management('/episodes'))?.status).toBe(200);
    expect((await management('/episodes/standalone'))?.status).toBe(200);
    expect((await management('/appearance'))?.status).toBe(200);
    expect(await management('/unknown')).toBeNull();
    expect((await management('/episodes/standalone?version=1', 'DELETE'))?.status).toBe(204);
    await expect(management('/appearance', 'PUT', { version: 99, theme: 'interval' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(management('/episodes', 'POST', {})).rejects.toMatchObject({ status: 400 });
    await expect(
      management('/productions/production-test', 'PUT', { version: 99, title: '不能保存' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      management('/productions/production-test', 'PATCH', { version: 1, title: '不支持' }),
    ).rejects.toMatchObject({ status: 405 });
    expect(spy).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it.each(['admin', 'agent'] as const)(
    'schedules pregeneration on the real %s Worker execution context without blocking the response',
    async (client) => {
      let complete!: () => void;
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const spy = vi.spyOn(pregeneration, 'pregenerateEpisodeArt').mockReturnValueOnce(pending);
      const waitUntil = vi.fn();
      const context = { waitUntil } as unknown as ExecutionContext;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (client === 'admin') {
        headers.Cookie = cookie;
        headers.Origin = origin;
      } else {
        const issued = await routeAgentTokens(
          request('/agent-tokens', 'POST', {
            name: 'Theme fixture',
            scopes: ['appearance:write'],
            expiresInDays: 1,
          }),
          env,
          '/agent-tokens',
          human,
        );
        headers.Authorization = `Bearer ${((await issued.json()) as { token: string }).token}`;
      }
      const prefix = client === 'admin' ? '/admin/api' : '/api/agent';
      try {
        const response = await worker.fetch(
          new Request(`${origin}${prefix}/appearance`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ version: 1, theme: 'interval' }),
          }),
          env,
          context,
        );
        expect(response.status, await response.clone().text()).toBe(200);
        expect(spy).toHaveBeenCalledExactlyOnceWith(env, origin, '/appearance');
        expect(waitUntil).toHaveBeenCalledExactlyOnceWith(pending);
      } finally {
        complete();
      }
    },
  );

  it('awaits pregeneration without a Worker execution context', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const spy = vi.spyOn(pregeneration, 'pregenerateEpisodeArt').mockReturnValueOnce(pending);
    let responded = false;
    const response = management('/appearance', 'PUT', { version: 1, theme: 'interval' }).then((value) => {
      responded = true;
      return value;
    });
    try {
      await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
      expect(responded).toBe(false);
    } finally {
      complete();
    }
    expect((await response)?.status).toBe(200);
  });
});
