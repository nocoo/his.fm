import { readdirSync, readFileSync } from 'node:fs';
import type { Scope } from '@his-fm/contracts';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeIds } from '../../src/shared/appearance';
import type { Episode } from '../../src/shared/episode';
import worker from '../../worker';
import { routeAgentTokens } from '../../worker/agent-tokens';
import { coverSource, routeCover } from '../../worker/cover';
import { loadCoverFonts } from '../../worker/cover-fonts';
import { renderCoverPng } from '../../worker/cover-raster';
import { getEpisode, mutateEpisode } from '../../worker/episodes';
import { HttpError } from '../../worker/http';
import { routeManagement } from '../../worker/management';
import { getProduction } from '../../worker/production-store';
import { agent, human, readyFixture } from './production-fixture';
import { putR2Fixture, r2FixtureWorker } from './r2-fixtures';

vi.mock('../../worker/cover-fonts', () => ({ loadCoverFonts: vi.fn() }));
vi.mock('../../worker/cover-raster', () => ({ renderCoverPng: vi.fn() }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const origin = 'https://hisfm.dev.hexly.ai';
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const production = readyFixture({ title: '下班后，还要追多少个 AI？' });
const assets: string[] = [];
const overrides = new Map<
  string,
  { body: string | Uint8Array<ArrayBuffer>; status?: number; headers?: Record<string, string> }
>();
let mf: Miniflare;
let env: Env;
let episode: Episode;
let cookie: string;

const request = (path: string, init: RequestInit = {}) => new Request(`${origin}${path}`, init);
const coverRequest = (query = 'theme=interval', method = 'GET') =>
  request(`/api/agent/productions/${production.id}/cover.png?${query}`, { method });
const granted = (...scopes: Scope[]) => ({ ...agent, scopes });

async function token(scopes: Scope[]) {
  const response = await routeAgentTokens(
    request('/admin/api/agent-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cover reader', scopes, expiresInDays: 1 }),
    }),
    env,
    '/agent-tokens',
    human,
  );
  return ((await response.json()) as { token: string }).token;
}

beforeAll(async () => {
  mf = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'finished-cover-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: r2FixtureWorker },
            },
          },
          env: {
            DB: { type: 'd1', name: 'finished-cover-test' },
            MEDIA: { type: 'r2', name: 'finished-cover-test' },
            MEDIA_BASE_URL: { type: 'json', value: 'https://f.no.mt' },
            ENVIRONMENT: { type: 'json', value: 'local' },
            ASSETS: {
              type: 'fetcher',
              handler: (input) => {
                const path = new URL(input.url).pathname;
                assets.push(path);
                const override = overrides.get(path);
                if (override) return new MiniflareResponse(override.body, override);
                try {
                  return new MiniflareResponse(readFileSync(new URL(`../../public${path}`, import.meta.url)));
                } catch {
                  return new MiniflareResponse('Not found', { status: 404 });
                }
              },
            },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  const directory = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort())
    await env.DB.batch(
      readFileSync(new URL(file, directory), 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
});

beforeEach(async () => {
  await env.DB.batch(
    ['productions', 'episodes', 'episode_number_claims', 'agent_tokens', 'local_sessions'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await env.DB.prepare(
    'INSERT INTO productions (id, version, stage, data, created_at, updated_at, write_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      production.id,
      production.version,
      production.stage,
      JSON.stringify(production),
      production.createdAt,
      production.updatedAt,
      'cover-test',
    )
    .run();
  const created = await mutateEpisode(
    request('/admin/api/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'finished-cover-test',
        episodeNumber: 1,
        title: production.title,
        summary: 'Saved summary',
        transcript: 'Private transcript, never cover text.',
        lead: '',
        researchNote: '',
        credits: '',
        body: '',
        topics: [],
        coverUrl: 'https://f.no.mt/cover.png',
        category: 'life',
        tags: [],
        durationSeconds: 0,
        audioUrl: null,
        status: 'draft',
        featured: false,
        publishedAt: null,
      }),
    }),
    env.DB,
    human,
  );
  episode = ((await created.json()) as { episode: Episode }).episode;
  await putR2Fixture(mf, 'cover.png', png);
  assets.length = 0;
  overrides.clear();
  vi.mocked(loadCoverFonts)
    .mockReset()
    .mockResolvedValue({
      fonts: [],
      families: {
        'noto-sans-sc': 'Test Sans',
        'noto-serif-sc': 'Test Serif',
        'space-grotesk': 'Test Space',
      },
    });
  vi.mocked(renderCoverPng).mockReset().mockResolvedValue(png);
  const login = await worker.fetch(
    request('/admin/api/dev-login', { method: 'POST', headers: { Origin: origin } }),
    env,
  );
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  expect(login.status).toBe(200);
});

afterAll(async () => mf.dispose());

describe('cover source resolution', () => {
  it('resolves local assets, same-origin media and only the configured CDN prefix', () => {
    expect(coverSource(origin, 'https://f.no.mt', '/images/episode-01.webp')).toEqual({
      assetPath: '/images/episode-01.webp',
      key: null,
    });
    expect(coverSource(origin, '/media', '/media/clean.webp')).toEqual({
      assetPath: null,
      key: 'clean.webp',
    });
    expect(coverSource(origin, 'https://cdn.test/podcast/', 'https://cdn.test/podcast/封面.webp')).toEqual({
      assetPath: null,
      key: '封面.webp',
    });
    expect(coverSource(origin, '/media', `${origin}/media/a%20b.png`)).toEqual({
      assetPath: null,
      key: 'a b.png',
    });
  });

  it.each([
    'http://[',
    'https://evil.test/a.png',
    'https://cdn.test/other/a.png',
    'http://cdn.test/podcast/a.png',
    'https://user:pass@cdn.test/podcast/a.png',
    'https://cdn.test/podcast/a.png?q=1',
    'https://cdn.test/podcast/a.png#x',
    '/media/',
    '/media/%zz',
    '/media/%00.png',
    '/media/%5c.png',
    '/media/a%2f..%2fb.png',
    '/media/a%2f.%2fb.png',
    'data:image/png;base64,AAAA',
    '/admin/api/productions',
  ])('rejects unsafe or unrelated stored source %s', (value) => {
    expect(() => coverSource(origin, 'https://cdn.test/podcast', value)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('maps only the three bundled local seed images without trusting arbitrary remote media', async () => {
    for (const number of ['01', '02', '03'])
      expect(coverSource(origin, '/media', `https://f.no.mt/images/episode-${number}.webp`, true)).toEqual({
        assetPath: `/images/episode-${number}.webp`,
        key: null,
      });
    expect(() => coverSource(origin, '/media', 'https://f.no.mt/images/episode-01.webp')).toThrow();
    expect(() => coverSource(origin, '/media', 'https://f.no.mt/private/cover.webp', true)).toThrow();
    await env.DB.prepare('UPDATE episodes SET cover_url=? WHERE id=?')
      .bind('https://f.no.mt/images/episode-01.webp', episode.id)
      .run();
    const local = { ...env, MEDIA_BASE_URL: '/media' };
    const result = await routeCover(coverRequest(), local, human, 'episodes', episode.id);
    expect(result.status).toBe(200);
    expect(assets).toEqual(['/images/episode-01.webp', '/brand/frames/interval.svg']);
    expect(await env.MEDIA.get('images/episode-01.webp')).toBeNull();
  });
});

describe('finished cover controller', () => {
  it.each(themeIds)(
    'composes %s from saved metadata and never writes the original or content',
    async (theme) => {
      const original = await env.MEDIA.get('cover.png');
      const response = await routeManagement(
        coverRequest(`theme=${theme}&version=1`),
        env,
        `/productions/${production.id}/cover.png`,
        granted('productions:read'),
      );
      if (!response) throw new Error('Cover route was not registered');
      expect(response?.status).toBe(200);
      expect(response?.headers.get('Content-Type')).toBe('image/png');
      expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response?.headers.get('X-Resource-Version')).toBe('1');
      expect(response?.headers.get('X-Cover-Theme')).toBe(theme);
      expect(response?.headers.get('Content-Disposition')).toContain(`his-fm-ep-008-${theme}.png`);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
      const svg = vi.mocked(renderCoverPng).mock.calls[0][0];
      expect(svg).toContain('data:image/png;base64,');
      expect(svg).toContain('下班后，还要');
      expect(svg).toContain('追多少个 AI？');
      expect(svg).toContain('生活留白');
      expect(svg).toContain('Test Sans');
      expect(svg.includes('data-cover-lockup="canonical"')).toBe(
        theme === 'stillwood' || theme === 'alpine-bloom',
      );
      expect(svg).not.toContain(production.transcript);
      expect(svg).not.toContain('Private transcript');
      expect(assets).toEqual([`/brand/frames/${theme}.svg`]);
      expect(await getProduction(env.DB, production.id)).toEqual(production);
      expect(await getEpisode(env.DB, episode.id, false, human)).toEqual(episode);
      expect((await env.MEDIA.get('cover.png'))?.etag).toBe(original?.etag);
    },
  );

  it('uses episode reads independently and supports same-origin media without storage grants', async () => {
    await env.DB.prepare('UPDATE episodes SET cover_url=? WHERE id=?')
      .bind('/media/cover.png', episode.id)
      .run();
    const result = await routeManagement(
      coverRequest(),
      { ...env, MEDIA_BASE_URL: '/media' },
      `/episodes/${episode.id}/cover.png`,
      granted('episodes:read'),
    );
    expect(result?.status).toBe(200);
    expect(result?.headers.get('Content-Disposition')).toContain('ep-001-interval');
    await expect(
      routeCover(coverRequest(), env, granted('productions:read'), 'episodes', episode.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      routeCover(coverRequest(), env, granted('episodes:read'), 'productions', production.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      routeCover(
        coverRequest(),
        env,
        granted('storage:read', 'productions:write'),
        'productions',
        production.id,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    '',
    'theme=invalid',
    'theme=interval&version=0',
    'theme=interval&version=1.5',
    'theme=interval&version=no',
    'theme=interval&version=1&version=2',
    'theme=interval&theme=grove',
    'theme=interval&url=https://evil.test',
    'theme=interval&version=',
  ])('rejects malformed or unexpected query %s before accessing media', async (query) => {
    await expect(
      routeCover(coverRequest(query), env, human, 'productions', production.id),
    ).rejects.toMatchObject({ status: 400 });
    expect(assets).toEqual([]);
    expect(renderCoverPng).not.toHaveBeenCalled();
  });

  it('rejects stale versions, missing records, missing artwork and unavailable frames', async () => {
    await expect(
      routeCover(coverRequest('theme=interval&version=2'), env, human, 'productions', production.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(routeCover(coverRequest(), env, human, 'productions', 'missing')).rejects.toMatchObject({
      status: 404,
    });
    await env.DB.prepare("UPDATE productions SET data=json_set(data, '$.assets.cover', NULL) WHERE id=?")
      .bind(production.id)
      .run();
    await expect(routeCover(coverRequest(), env, human, 'productions', production.id)).rejects.toMatchObject({
      status: 409,
    });
    await env.MEDIA.delete('cover.png');
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 404,
    });
    await putR2Fixture(mf, 'cover.png', png);
    overrides.set('/brand/frames/interval.svg', { body: '', status: 503 });
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 503,
    });
    overrides.set('/brand/frames/interval.svg', { body: '<html>Asset not found</html>' });
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 503,
    });
    overrides.set('/brand/frames/interval.svg', { body: 'x'.repeat(256 * 1024 + 1) });
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 413,
    });
    expect(renderCoverPng).not.toHaveBeenCalled();
  });

  it('fails closed on oversized, invalid and missing source bodies', async () => {
    await putR2Fixture(mf, 'cover.png', new Uint8Array(4 * 1024 * 1024 + 1));
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 413,
    });
    await env.MEDIA.put('cover.png', '<svg/>');
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 415,
    });
    await env.DB.prepare('UPDATE episodes SET cover_url=? WHERE id=?')
      .bind('/images/missing.png', episode.id)
      .run();
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 404,
    });
    overrides.set('/images/missing.png', {
      body: png,
      headers: { 'Content-Length': String(4 * 1024 * 1024 + 1) },
    });
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 413,
    });
    expect(renderCoverPng).not.toHaveBeenCalled();
  });

  it('reports decoding errors and font failures without returning a partial image', async () => {
    vi.mocked(renderCoverPng).mockRejectedValueOnce(new Error('Invalid image'));
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 422,
    });
    vi.mocked(loadCoverFonts).mockRejectedValueOnce(new Error('Fonts unavailable'));
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toThrow(
      'Fonts unavailable',
    );
    expect(renderCoverPng).toHaveBeenCalledTimes(1);
  });

  it('preserves shared JPEG renderer contention and releases the PNG entry guard', async () => {
    vi.mocked(renderCoverPng).mockRejectedValueOnce(new HttpError(503, 'busy'));
    const busy = await routeCover(coverRequest(), env, human, 'episodes', episode.id);
    expect(busy.status).toBe(503);
    expect(busy.headers.get('Retry-After')).toBe('1');
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
    expect((await routeCover(coverRequest(), env, human, 'episodes', episode.id)).status).toBe(200);
    vi.mocked(renderCoverPng).mockRejectedValueOnce(new HttpError(413, 'too large'));
    await expect(routeCover(coverRequest(), env, human, 'episodes', episode.id)).rejects.toMatchObject({
      status: 413,
    });
  });

  it('admits one memory-bounded composition per isolate and releases capacity on completion', async () => {
    let finish: (bytes: Uint8Array) => void = () => {};
    let started: () => void = () => {};
    const rendering = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(renderCoverPng).mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const first = routeCover(coverRequest(), env, human, 'episodes', episode.id);
    await rendering;
    try {
      const busy = await routeCover(coverRequest(), env, human, 'episodes', episode.id);
      expect(busy.status).toBe(503);
      expect(busy.headers.get('Retry-After')).toBe('1');
      expect(await busy.json()).toMatchObject({
        code: 'unavailable',
        documentation: `${origin}/api/agent/instructions`,
      });
      expect(renderCoverPng).toHaveBeenCalledTimes(1);
    } finally {
      finish(png);
      expect((await first).status).toBe(200);
    }
    expect((await routeCover(coverRequest(), env, human, 'episodes', episode.id)).status).toBe(200);
  });
});

describe('authenticated PNG routes', () => {
  it('requires a valid bearer token or human session and preserves scope separation', async () => {
    const path = `/episodes/${episode.id}/cover.png?theme=interval&version=1`;
    expect((await worker.fetch(request(`/api/agent${path}`), env)).status).toBe(401);
    expect((await worker.fetch(request(`/admin/api${path}`), env)).status).toBe(401);
    const denied = await token(['episodes:write', 'storage:read']);
    expect(
      (
        await worker.fetch(
          request(`/api/agent${path}`, { headers: { Authorization: `Bearer ${denied}` } }),
          env,
        )
      ).status,
    ).toBe(403);
    const reader = await token(['episodes:read']);
    const response = await worker.fetch(
      request(`/api/agent${path}`, { headers: { Authorization: `Bearer ${reader}` } }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Link')).toContain('/api/agent/openapi.json');
    expect(response.headers.get('Content-Type')).toBe('image/png');
    const admin = await worker.fetch(request(`/admin/api${path}`, { headers: { Cookie: cookie } }), env);
    expect(admin.status).toBe(200);
    expect(new Uint8Array(await admin.arrayBuffer())).toEqual(png);
  });

  it.each(['productions', 'episodes'] as const)(
    'documents allowed methods and raster errors on the %s route',
    async (resource) => {
      const reader = await token([resource === 'productions' ? 'productions:read' : 'episodes:read']);
      const id = resource === 'productions' ? production.id : episode.id;
      const headers = { Authorization: `Bearer ${reader}` };
      const path = `/api/agent/${resource}/${id}/cover.png?theme=interval`;
      const wrongMethod = await worker.fetch(request(path, { method: 'POST', headers }), env);
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get('Allow')).toBe('GET');
      expect(renderCoverPng).not.toHaveBeenCalled();
      vi.mocked(renderCoverPng).mockRejectedValueOnce(new Error('Decode failure'));
      const invalid = await worker.fetch(request(path, { headers }), env);
      expect(invalid.status).toBe(422);
      expect(await invalid.json()).toMatchObject({ code: 'invalid_cover' });
      expect(await getProduction(env.DB, production.id)).toEqual(production);
    },
  );
});
