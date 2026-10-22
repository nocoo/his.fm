import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeIds } from '../../src/shared/appearance';
import { composeCoverSvg, coverText } from '../../src/shared/cover-composition';
import { artLocation } from '../../src/shared/episode-art';
import worker from '../../worker';
import { loadCoverFonts } from '../../worker/cover-fonts';
import * as raster from '../../worker/cover-raster';
import { routeEpisodeArt } from '../../worker/episode-art';
import { HttpError } from '../../worker/http';
import { cacheablePublicRequest } from '../../worker/public-cache';
import { putR2Fixture, r2FixtureWorker } from './r2-fixtures';

vi.mock('@takumi-rs/wasm/takumi_wasm_bg.wasm', async () => ({
  default: new WebAssembly.Module(
    readFileSync(
      new URL('../../../../node_modules/@takumi-rs/wasm/pkg/takumi_wasm_bg.wasm', import.meta.url),
    ),
  ),
}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const origin = 'https://his.fm';
const key = 'productions/one/cover.webp';
const source = readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url));
const assetOverrides = new Map<string, { body: string; status?: number; headers?: Record<string, string> }>();
const assetReads: string[] = [];
let mf: Miniflare;
let env: Env;
const request = (kind = 'art', query = '', method = 'GET', id = 'one') =>
  new Request(`${origin}/episodes/${id}/${kind}.jpg${query}`, { method });
const call = async (kind: 'art' | 'share' = 'art', query = '', method = 'GET', bindings = env) => {
  const response = await routeEpisodeArt(request(kind, query, method), bindings, 'one', kind);
  return response.status === 302
    ? routeEpisodeArt(
        new Request(new URL(response.headers.get('Location') ?? '', origin), { method }),
        bindings,
        'one',
        kind,
      )
    : response;
};

beforeAll(async () => {
  mf = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'episode-art-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: r2FixtureWorker },
            },
          },
          env: {
            DB: { type: 'd1', name: 'episode-art-test' },
            MEDIA: { type: 'r2', name: 'episode-art-test' },
            IMAGES: { type: 'images', dev: { remote: false } },
            ENVIRONMENT: { type: 'json', value: 'production' },
            MEDIA_BASE_URL: { type: 'json', value: 'https://f.no.mt' },
            ASSETS: {
              type: 'fetcher',
              handler: (input) => {
                const path = new URL(input.url).pathname;
                assetReads.push(path);
                const override = assetOverrides.get(path);
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
  await env.DB.batch([
    env.DB.prepare(
      'CREATE TABLE episodes (id TEXT PRIMARY KEY, title TEXT, episode_number INTEGER, cover_url TEXT, category TEXT, status TEXT, published_at TEXT)',
    ),
    env.DB.prepare('CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT)'),
    env.DB.prepare("INSERT INTO categories VALUES ('life', '生活')"),
    env.DB.prepare(
      'CREATE TABLE site_appearance (id INTEGER PRIMARY KEY, theme TEXT, version INTEGER, updated_at TEXT, updated_by TEXT)',
    ),
    env.DB.prepare("INSERT INTO site_appearance VALUES (1, 'stillwood', 1, '', '')"),
  ]);
});

beforeEach(async () => {
  const cached = await env.MEDIA.list({ prefix: 'rendered/' });
  if (cached.objects.length) await env.MEDIA.delete(cached.objects.map((object) => object.key));
  assetOverrides.clear();
  assetReads.length = 0;
  await env.DB.prepare('DELETE FROM episodes').run();
  await env.DB.prepare('INSERT INTO episodes VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      'one',
      '下班后，慢慢来',
      1,
      `https://f.no.mt/${key}`,
      'life',
      'published',
      '2020-01-01T00:00:00.000Z',
    )
    .run();
  await env.DB.prepare("UPDATE site_appearance SET theme = 'stillwood'").run();
  await env.DB.prepare("UPDATE categories SET name = '生活'").run();
  await putR2Fixture(mf, key, source);
});
afterAll(async () => {
  await mf.dispose();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('versioned artwork edge cache', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  let edge: Cache;

  beforeEach(async () => {
    await mf.purgeCache();
    edge = Reflect.get(await mf.getCaches(), 'default');
    vi.stubGlobal('caches', { default: edge });
  });

  async function pregenerated(kind: 'art' | 'share', size = 1400) {
    const location = await artLocation(
      {
        resource: 'episodes',
        id: 'one',
        title: '下班后，慢慢来',
        episodeNumber: 1,
        categoryName: '生活',
        coverUrl: `https://f.no.mt/${key}`,
      },
      kind === 'art' ? 'stillwood' : null,
      size,
    );
    await env.MEDIA.put(location.key, bytes);
    return new URL(location.url, origin);
  }

  it.each(['stillwood', 'alpine-bloom'] as const)(
    'redirects cached pre-lockup %s URLs before reading either cache',
    async (theme) => {
      await env.DB.prepare('UPDATE site_appearance SET theme = ?').bind(theme).run();
      const record = {
        resource: 'episodes' as const,
        id: 'one',
        title: '下班后，慢慢来',
        episodeNumber: 1,
        categoryName: '生活',
        coverUrl: `https://f.no.mt/${key}`,
      };
      const oldVersion = createHash('sha256')
        .update(JSON.stringify(['jpeg-v1', record.coverUrl, theme, record.title, 1, '生活']))
        .digest('hex');
      const oldRequest = request('art', `?v=${oldVersion}`);
      await edge.put(oldRequest, new Response(bytes));
      await env.MEDIA.put(`rendered/episodes/one/art/${theme}/${oldVersion}/1400.jpg`, bytes);
      const head = vi.fn(env.MEDIA.head.bind(env.MEDIA));
      const response = await routeEpisodeArt(
        oldRequest,
        { ...env, MEDIA: { ...env.MEDIA, head } },
        'one',
        'art',
      );
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe((await artLocation(record, theme)).url);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(head).not.toHaveBeenCalled();
      expect(await response.text()).toBe('');
    },
  );

  it.each(['art', 'share'] as const)(
    'serves pregenerated %s then edge GET, HEAD and 304 without R2',
    async (kind) => {
      const url = await pregenerated(kind);
      const render = vi.spyOn(raster, 'renderCoverJpeg');
      const first = await routeEpisodeArt(new Request(url), env, 'one', kind);
      expect(first.headers.get('X-Hisfm-Art')).toBe('r2-hit');
      expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);
      const head = vi.fn(env.MEDIA.head.bind(env.MEDIA));
      const get = vi.fn(env.MEDIA.get.bind(env.MEDIA));
      const bindings = { ...env, MEDIA: { ...env.MEDIA, head, get } };
      for (const method of ['GET', 'HEAD']) {
        const response = await routeEpisodeArt(new Request(url, { method }), bindings, 'one', kind);
        expect(response.status).toBe(200);
        expect(response.headers.get('X-Hisfm-Art')).toBe('edge-hit');
        expect(response.headers.has('X-Hisfm-Art-Length')).toBe(false);
        for (const name of ['ETag', 'Last-Modified', 'Content-Type', 'Content-Length', 'Cache-Control'])
          expect(response.headers.get(name)).toBe(first.headers.get(name));
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          method === 'HEAD' ? new Uint8Array() : bytes,
        );
      }
      for (const method of ['GET', 'HEAD']) {
        for (const headers of [
          { 'If-None-Match': first.headers.get('ETag') ?? '' },
          { 'If-None-Match': `"other", W/${first.headers.get('ETag')}` },
          { 'If-None-Match': '*' },
          { 'If-Modified-Since': first.headers.get('Last-Modified') ?? '' },
        ] as HeadersInit[]) {
          const response = await routeEpisodeArt(
            new Request(url, { method, headers }),
            bindings,
            'one',
            kind,
          );
          expect(response.status).toBe(304);
          expect(response.headers.get('X-Hisfm-Art')).toBe('edge-hit');
          expect(response.headers.get('ETag')).toBe(first.headers.get('ETag'));
          expect(response.headers.has('Content-Length')).toBe(false);
          expect(await response.text()).toBe('');
        }
      }
      for (const headers of [
        { 'If-None-Match': '"other"', 'If-Modified-Since': 'Fri, 01 Jan 2100 00:00:00 GMT' },
        { 'If-Modified-Since': 'Wed, 01 Jan 2020 00:00:00 GMT' },
        { 'If-Modified-Since': 'invalid' },
      ] as HeadersInit[]) {
        const response = await routeEpisodeArt(new Request(url, { headers }), bindings, 'one', kind);
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      }
      expect(head).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    },
  );

  it('keeps cold HEAD and conditional responses out of the GET cache', async () => {
    const url = await pregenerated('share');
    const head = await routeEpisodeArt(new Request(url, { method: 'HEAD' }), env, 'one', 'share');
    expect(head.headers.get('X-Hisfm-Art')).toBe('r2-hit');
    expect(await head.text()).toBe('');
    expect(await edge.match(url.href)).toBeUndefined();
    const conditional = await routeEpisodeArt(
      new Request(url, { headers: { 'If-None-Match': '*' } }),
      env,
      'one',
      'share',
    );
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get('X-Hisfm-Art')).toBe('r2-hit');
    expect(await edge.match(url.href)).toBeUndefined();
    const response = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('X-Hisfm-Art')).toBe('r2-hit');
  });

  it('renders a missing generated object once before serving it from the edge', async () => {
    const redirect = await routeEpisodeArt(request('share'), env, 'one', 'share');
    const url = new URL(redirect.headers.get('Location') ?? '', origin);
    const first = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    expect(first.headers.get('X-Hisfm-Art')).toBe('rendered');
    const rendered = await first.arrayBuffer();
    const second = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    expect(second.headers.get('X-Hisfm-Art')).toBe('edge-hit');
    expect(Buffer.from(await second.arrayBuffer()).equals(Buffer.from(rendered))).toBe(true);
  });

  it('uses the complete URL, separating kind, size, host and query order', async () => {
    const art = await pregenerated('art');
    const large = await pregenerated('art', 1600);
    const share = await pregenerated('share');
    const reordered = new URL(large);
    reordered.search = `?size=1600&v=${large.searchParams.get('v')}`;
    const otherHost = new URL(share);
    otherHost.host = 'example.test';
    for (const url of [art, large, share, reordered, otherHost]) {
      const kind = url.pathname.endsWith('share.jpg') ? 'share' : 'art';
      const response = await routeEpisodeArt(new Request(url), env, 'one', kind);
      expect(response.headers.get('X-Hisfm-Art')).toBe('r2-hit');
      await response.arrayBuffer();
      const repeat = await routeEpisodeArt(new Request(url), env, 'one', kind);
      expect(repeat.headers.get('X-Hisfm-Art')).toBe('edge-hit');
      await repeat.arrayBuffer();
    }
  });

  it.each([
    "UPDATE episodes SET status = 'draft'",
    "UPDATE episodes SET published_at = '2999-01-01T00:00:00.000Z'",
    'DELETE FROM episodes',
  ])('rechecks publication before cache lookup: %s', async (sql) => {
    const url = await pregenerated('share');
    await (await routeEpisodeArt(new Request(url), env, 'one', 'share')).arrayBuffer();
    await env.DB.prepare(sql).run();
    const match = vi.fn();
    vi.stubGlobal('caches', { default: { match } });
    await expect(routeEpisodeArt(new Request(url), env, 'one', 'share')).rejects.toMatchObject({
      status: 404,
    });
    expect(match).not.toHaveBeenCalled();
  });

  it.each([
    "UPDATE episodes SET cover_url = '/media/new.webp'",
    "UPDATE episodes SET title = 'New title'",
    'UPDATE episodes SET episode_number = 2',
    "UPDATE categories SET name = '新栏目'",
    "UPDATE site_appearance SET theme = 'interval'",
  ])('redirects changed versions before cache lookup: %s', async (sql) => {
    const url = await pregenerated('art');
    await (await routeEpisodeArt(new Request(url), env, 'one', 'art')).arrayBuffer();
    await env.DB.prepare(sql).run();
    const match = vi.fn();
    vi.stubGlobal('caches', { default: { match } });
    const response = await routeEpisodeArt(new Request(url), env, 'one', 'art');
    expect(response.status).toBe(302);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Location')).not.toBe(`${url.pathname}${url.search}`);
    expect(response.headers.has('X-Hisfm-Art')).toBe(false);
    expect(match).not.toHaveBeenCalled();
  });

  it('never caches plain redirects, invalid requests or errors', async () => {
    const url = await pregenerated('share');
    const match = vi.fn();
    const put = vi.fn();
    vi.stubGlobal('caches', { default: { match, put } });
    const redirect = await routeEpisodeArt(request('share'), env, 'one', 'share');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Cache-Control')).toBe('no-store');
    for (const input of [
      new Request(url, { method: 'POST' }),
      new Request(`${url}&extra=1`),
      new Request(`${url}&v=bad`),
    ])
      await expect(routeEpisodeArt(input, env, 'one', 'share')).rejects.toBeInstanceOf(HttpError);
    expect(match).not.toHaveBeenCalled();
    match.mockResolvedValue(undefined);
    const bindings = {
      ...env,
      MEDIA: { ...env.MEDIA, head: env.MEDIA.head.bind(env.MEDIA), get: vi.fn().mockResolvedValue(null) },
    };
    const response = await routeEpisodeArt(new Request(url), bindings, 'one', 'share');
    expect(response.status).toBe(503);
    expect(response.headers.has('X-Hisfm-Art')).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps serving artwork on cache read and write failures', async () => {
    const url = await pregenerated('share');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const put = vi.fn(async (_key: Request, response: Response) => {
      await response.arrayBuffer();
      throw new Error('write unavailable');
    });
    vi.stubGlobal('caches', {
      default: { match: vi.fn().mockRejectedValue(new Error('read unavailable')), put },
    });
    const response = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Hisfm-Art')).toBe('r2-hit');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(log.mock.calls.map(([message]) => JSON.parse(message).event)).toEqual([
      'episode_art_edge_read_failed',
      'episode_art_edge_write_failed',
    ]);
  });

  it('passes background cache writes through the gateway context without caching request headers', async () => {
    const url = await pregenerated('share');
    const writes: Promise<unknown>[] = [];
    const put = vi.fn(async (cacheKey: Request, response: Response) => {
      expect(cacheKey.method).toBe('GET');
      expect([...cacheKey.headers]).toEqual([]);
      await edge.put(cacheKey, response);
    });
    vi.stubGlobal('caches', { default: { match: vi.fn().mockResolvedValue(undefined), put } });
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        writes.push(promise);
      },
    } as ExecutionContext;
    const response = await worker.fetch(
      new Request(url, {
        headers: { Cookie: 'private=session', Authorization: 'Bearer private', Range: 'bytes=0-1' },
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
    await Promise.all(writes);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const stored = await edge.match(url.href);
    expect(stored?.status).toBe(200);
    expect(stored?.headers.has('Set-Cookie')).toBe(false);
    await stored?.arrayBuffer();
  });

  it('does not use the production edge cache in local development', async () => {
    const url = await pregenerated('share');
    const match = vi.fn();
    vi.stubGlobal('caches', { default: { match } });
    const response = await routeEpisodeArt(
      new Request(url),
      { ...env, ENVIRONMENT: 'local' },
      'one',
      'share',
    );
    expect(response.headers.get('X-Hisfm-Art')).toBe('r2-hit');
    expect(match).not.toHaveBeenCalled();
    await response.arrayBuffer();
  });
});

describe('public episode JPEG artwork', () => {
  it('serves immutable cache hits, HEAD and conditional requests without rendering again', async () => {
    const redirect = await routeEpisodeArt(request('share'), env, 'one', 'share');
    const url = new URL(redirect.headers.get('Location') ?? '', origin);
    const first = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    expect(first.headers.get('X-Hisfm-Art')).toBe('rendered');
    const bytes = await first.arrayBuffer();
    const render = vi.spyOn(raster, 'renderCoverJpeg');
    const head = vi.fn((key: string) => env.MEDIA.head(key));
    const get = vi.fn((key: string) => env.MEDIA.get(key));
    const bindings = { ...env, MEDIA: { head, get } as unknown as R2Bucket };
    const second = await routeEpisodeArt(new Request(url), bindings, 'one', 'share');
    expect(second.headers.get('X-Hisfm-Art')).toBe('r2-hit');
    expect(Buffer.from(await second.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    const cachedHead = await routeEpisodeArt(new Request(url, { method: 'HEAD' }), bindings, 'one', 'share');
    expect(cachedHead.headers).toEqual(second.headers);
    expect(await cachedHead.text()).toBe('');
    expect(get).toHaveBeenCalledTimes(1);
    for (const headers of [
      { 'If-None-Match': first.headers.get('ETag') ?? '' },
      { 'If-None-Match': `"other", W/${first.headers.get('ETag')}` },
      { 'If-None-Match': '*' },
      { 'If-Modified-Since': first.headers.get('Last-Modified') ?? '' },
    ] as HeadersInit[]) {
      const response = await routeEpisodeArt(new Request(url, { headers }), bindings, 'one', 'share');
      expect(response.status).toBe(304);
      expect(response.headers.get('X-Hisfm-Art')).toBe('r2-hit');
      expect(await response.text()).toBe('');
      expect(response.headers.has('Content-Length')).toBe(false);
    }
    for (const headers of [
      { 'If-None-Match': '"other"', 'If-Modified-Since': 'Fri, 01 Jan 2100 00:00:00 GMT' },
      { 'If-Modified-Since': 'Wed, 01 Jan 2020 00:00:00 GMT' },
      { 'If-Modified-Since': 'invalid' },
    ] as HeadersInit[])
      expect((await routeEpisodeArt(new Request(url, { headers }), env, 'one', 'share')).status).toBe(200);
    expect(head).toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE episodes SET status = 'draft'").run();
    await expect(routeEpisodeArt(new Request(url), env, 'one', 'share')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('changes art URLs for copy and category edits and both variants for a new original', async () => {
    const location = async (kind: 'art' | 'share') =>
      (await routeEpisodeArt(request(kind), env, 'one', kind)).headers.get('Location');
    let art = await location('art');
    const share = await location('share');
    for (const sql of [
      "UPDATE episodes SET title = 'New title'",
      'UPDATE episodes SET episode_number = 2',
      "UPDATE categories SET name = '新栏目'",
    ]) {
      await env.DB.prepare(sql).run();
      const updated = await location('art');
      expect(updated).not.toBe(art);
      expect(await location('share')).toBe(share);
      art = updated;
    }
    await env.DB.prepare("UPDATE episodes SET cover_url = '/media/new-original.webp'").run();
    expect(await location('art')).not.toBe(art);
    expect(await location('share')).not.toBe(share);
    const stale = await routeEpisodeArt(new Request(new URL(share ?? '', origin)), env, 'one', 'share');
    expect(stale.status).toBe(302);
    expect(stale.headers.get('Location')).toBe(await location('share'));
    await env.DB.prepare("UPDATE categories SET name = '生活'").run();
  });

  it('keeps cached objects immutable when another isolate wins storage', async () => {
    const put = env.MEDIA.put.bind(env.MEDIA);
    const bindings = {
      ...env,
      MEDIA: {
        get: (key: string) => env.MEDIA.get(key),
        head: (key: string) => env.MEDIA.head(key),
        put: async (...args: Parameters<R2Bucket['put']>) => {
          await put(...args);
          return null;
        },
      } as unknown as R2Bucket,
    };
    expect((await call('share', '', 'GET', bindings)).status).toBe(200);
  });

  it('reports unavailable cache storage and allows a later retry', async () => {
    const bindings = {
      ...env,
      MEDIA: {
        get: (key: string) => env.MEDIA.get(key),
        head: (key: string) => env.MEDIA.head(key),
        put: async () => null,
      } as unknown as R2Bucket,
    };
    expect((await call('share', '', 'GET', bindings)).status).toBe(503);
    await call('share');
    bindings.MEDIA.get = vi.fn().mockResolvedValue(null);
    expect((await call('share', '', 'GET', bindings)).status).toBe(503);
  });
  it.each([
    ['art', 1400, 1400],
    ['share', 1200, 630],
  ] as const)('serves %s through the uncached gateway with real JPEG bytes', async (kind, width, height) => {
    const fetch = vi.fn();
    const context = { exports: { PublicContent: { fetch } } } as unknown as ExecutionContext;
    const redirect = await worker.fetch(request(kind), env, context);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Cache-Control')).toBe('no-store');
    const response = await worker.fetch(
      new Request(new URL(redirect.headers.get('Location') ?? '', origin)),
      env,
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.has('ETag')).toBe(true);
    expect(response.headers.has('Last-Modified')).toBe(true);
    expect(response.headers.has('X-Public-Cache')).toBe(false);
    expect(cacheablePublicRequest(request(kind))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    const bytes = await response.arrayBuffer();
    expect(Number(response.headers.get('Content-Length'))).toBe(bytes.byteLength);
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({
      format: 'jpeg',
      width,
      height,
      space: 'srgb',
      channels: 3,
      hasAlpha: false,
    });
    expect(metadata.icc).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    const stored = await env.MEDIA.get(key);
    if (!stored) throw new Error('Missing original');
    expect(Buffer.from(await new Response(stored.body).arrayBuffer()).equals(source)).toBe(true);
  });

  it.each([1024, 1400, 3000])(
    'renders a 3000-square output from a %i-square original',
    async (originalSize) => {
      const original = await sharp(source).resize(originalSize, originalSize).jpeg().toBuffer();
      await putR2Fixture(mf, key, original);
      const response = await call('art', '?size=3000');
      const metadata = await sharp(await response.arrayBuffer()).metadata();
      expect(metadata).toMatchObject({
        format: 'jpeg',
        width: 3000,
        height: 3000,
        space: 'srgb',
        channels: 3,
        hasAlpha: false,
      });
      expect(metadata.icc).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
    },
  );

  it.each(themeIds)('preserves the existing %s framed composition', async (theme) => {
    await env.DB.prepare('UPDATE site_appearance SET theme = ?').bind(theme).run();
    const actual = Buffer.from(await (await call('art', '?size=1600')).arrayBuffer());
    const copy = { title: '下班后，慢慢来', episodeNumber: 1, categoryName: '生活' };
    const { fonts, families } = await loadCoverFonts(env, origin, coverText(theme, copy));
    const frame = readFileSync(new URL(`../../public/brand/frames/${theme}.svg`, import.meta.url), 'utf8');
    const expected = await raster.renderCoverPng(
      composeCoverSvg(theme, copy, `data:image/webp;base64,${source.toString('base64')}`, frame, families),
      fonts,
    );
    const difference = await sharp(actual)
      .composite([{ input: Buffer.from(expected), blend: 'difference' }])
      .removeAlpha()
      .png()
      .toBuffer();
    const { channels } = await sharp(difference).stats();
    expect(Math.max(...channels.map((channel) => channel.mean))).toBeLessThan(5);
  });

  it('preserves transparent original pixels over the theme paper', async () => {
    const original = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: { r: 220, g: 40, b: 80, alpha: 0.2 } },
    })
      .png()
      .toBuffer();
    await putR2Fixture(mf, key, original);
    const actual = Buffer.from(await (await call('art', '?size=1600')).arrayBuffer());
    const copy = { title: '下班后，慢慢来', episodeNumber: 1, categoryName: '生活' };
    const { fonts, families } = await loadCoverFonts(env, origin, coverText('stillwood', copy));
    const frame = readFileSync(new URL('../../public/brand/frames/stillwood.svg', import.meta.url), 'utf8');
    const expected = await raster.renderCoverPng(
      composeCoverSvg(
        'stillwood',
        copy,
        `data:image/png;base64,${original.toString('base64')}`,
        frame,
        families,
      ),
      fonts,
    );
    const difference = await sharp(actual)
      .composite([{ input: Buffer.from(expected), blend: 'difference' }])
      .removeAlpha()
      .png()
      .toBuffer();
    const { channels } = await sharp(difference).stats();
    expect(Math.max(...channels.map((channel) => channel.mean))).toBeLessThan(2);
  });

  it('versions the saved theme and serves cached bytes without rereading originals', async () => {
    const first = Buffer.from(await (await call()).arrayBuffer());
    await env.DB.prepare("UPDATE site_appearance SET theme = 'interval'").run();
    const second = Buffer.from(await (await call()).arrayBuffer());
    expect(first.equals(second)).toBe(false);
    expect(assetReads).toContain('/brand/frames/interval.svg');
    await env.MEDIA.delete(key);
    expect(Buffer.from(await (await call()).arrayBuffer()).equals(second)).toBe(true);
  });

  it('keeps share artwork independent of theme and episode copy', async () => {
    const first = Buffer.from(await (await call('share')).arrayBuffer());
    await env.DB.prepare("UPDATE site_appearance SET theme = 'grove'").run();
    await env.DB.prepare("UPDATE episodes SET title = 'Different title', episode_number = 999").run();
    const second = Buffer.from(await (await call('share')).arrayBuffer());
    expect(first.equals(second)).toBe(true);
    expect(assetReads.every((path) => path === '/brand/stillwood-wordmark.svg')).toBe(true);
  });

  it.each([
    [1400, 1400],
    [700, 1400],
    [1400, 900],
    [2800, 700],
  ])('anchors the share band at 0.4 and clamps a %i x %i original', async (width, height) => {
    const pixels = Buffer.alloc(width * height * 3);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const offset = (row * width + column) * 3;
        pixels[offset] = Math.round((column / width) * 255);
        pixels[offset + 1] = Math.round((row / height) * 255);
        pixels[offset + 2] = 100;
      }
    }
    const original = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    await putR2Fixture(mf, key, original);
    const response = await call('share');
    const { data, info } = await sharp(await response.arrayBuffer())
      .raw()
      .toBuffer({ resolveWithObject: true });
    const scale = Math.max(1200 / width, 630 / height);
    const cropHeight = 630 / scale;
    const top = Math.max(0, Math.min(height - cropHeight, height * 0.4 - cropHeight / 2));
    for (const row of [5, 315, 624]) {
      const offset = (row * info.width + 600) * info.channels;
      expect(Math.abs(data[offset] - 128)).toBeLessThan(4);
      expect(Math.abs(data[offset + 1] - ((top + row / scale) / height) * 255)).toBeLessThan(4);
      expect(Math.abs(data[offset + 2] - 100)).toBeLessThan(4);
    }
  });

  it('supports bodyless HEAD with the same JPEG headers', async () => {
    const response = await call('share', '', 'HEAD');
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(Number(response.headers.get('Content-Length'))).toBeGreaterThan(1000);
    expect(await response.text()).toBe('');
  });

  it.each(['draft', 'withdrawn', 'future', 'missing'])('does not disclose %s episodes', async (state) => {
    if (state === 'missing') await env.DB.prepare('DELETE FROM episodes').run();
    else if (state === 'future')
      await env.DB.prepare("UPDATE episodes SET published_at = '2999-01-01T00:00:00Z'").run();
    else await env.DB.prepare('UPDATE episodes SET status = ?').bind(state).run();
    for (const kind of ['art', 'share']) {
      const response = await worker.fetch(request(kind), env);
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(assetReads).toEqual([]);
  });

  it.each([
    '?size=1399',
    '?size=3001',
    '?size=1500.5',
    '?size=',
    '?theme=grove',
    '?size=1400&size=1400',
    '?v=invalid',
    `?v=${'a'.repeat(64)}&v=${'a'.repeat(64)}`,
  ])('rejects invalid or duplicate options %s', async (query) => {
    await expect(call('art', query)).rejects.toMatchObject({ status: 400 });
    expect(cacheablePublicRequest(request('art', query))).toBe(false);
  });

  it('rejects share options, mutations and malformed encoded IDs', async () => {
    await expect(call('share', '?size=1400')).rejects.toMatchObject({ status: 400 });
    await expect(call('art', '', 'POST')).rejects.toMatchObject({ status: 405 });
    await expect(routeEpisodeArt(request(), env, '%xx', 'art')).rejects.toMatchObject({ status: 400 });
    await env.DB.prepare("UPDATE episodes SET id = 'one two'").run();
    const response = await worker.fetch(request('share', '', 'GET', 'one%20two'), env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/episodes/one%20two/share.jpg?v=');
  });

  it('only reads trusted sources and preserves local seed support', async () => {
    await env.DB.prepare("UPDATE episodes SET cover_url = 'https://untrusted.example/secret.jpg'").run();
    await expect(call()).rejects.toMatchObject({ status: 400 });
    await env.DB.prepare("UPDATE episodes SET cover_url = 'https://f.no.mt/images/episode-01.webp'").run();
    const response = await call('share', '', 'GET', { ...env, ENVIRONMENT: 'local' });
    expect(response.status).toBe(200);
    expect(assetReads).toContain('/images/episode-01.webp');
  });

  it('rejects oversized sources and invalid pixels, then recovers', async () => {
    const body = new ReadableStream();
    const cancel = vi.spyOn(body, 'cancel');
    const bindings = {
      ...env,
      MEDIA: { head: () => null, get: async () => ({ size: 20_000_001, body }) },
    } as unknown as Env;
    await expect(call('share', '', 'GET', bindings)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
    await env.MEDIA.put(key, 'corrupt image');
    await expect(call('share')).rejects.toMatchObject({ status: 422 });
    await putR2Fixture(mf, key, source);
    expect((await call('share')).status).toBe(200);
  });

  it('fails explicitly for unavailable or malformed frame and local source assets', async () => {
    const path = '/brand/stillwood-wordmark.svg';
    assetOverrides.set(path, { body: 'missing', status: 404 });
    expect((await call('share')).status).toBe(503);
    assetOverrides.set(path, { body: 'invalid' });
    expect((await call('share')).status).toBe(503);
    assetOverrides.clear();
    await env.DB.prepare("UPDATE episodes SET cover_url = '/images/missing.png'").run();
    await expect(call('share')).rejects.toMatchObject({ status: 404 });
    assetOverrides.set('/images/missing.png', { body: '', headers: { 'Content-Length': '20000001' } });
    await expect(call('share')).rejects.toMatchObject({ status: 413 });
  });

  it('bounds simultaneous cache-miss composition without queuing', async () => {
    let notifyReady = () => {};
    let release: (object: R2ObjectBody | null) => void = () => {};
    const ready = new Promise<void>((resolve) => {
      notifyReady = resolve;
    });
    const released = new Promise<R2ObjectBody | null>((resolve) => {
      release = resolve;
    });
    const bindings = {
      ...env,
      MEDIA: {
        head: (objectKey: string) => env.MEDIA.head(objectKey),
        put: (objectKey: string, value: Uint8Array, options: R2PutOptions) =>
          env.MEDIA.put(objectKey, value, options),
        get: (objectKey: string) => {
          if (objectKey !== key) return env.MEDIA.get(objectKey);
          notifyReady();
          return released;
        },
      },
    } as unknown as Env;
    const pending = call('share', '', 'GET', bindings);
    await ready;
    const busy = await call('share');
    expect(busy.status).toBe(503);
    expect(busy.headers.get('Retry-After')).toBe('1');
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
    release(await env.MEDIA.get(key));
    expect((await pending).status).toBe(200);
  });

  it('preserves shared PNG renderer contention and releases the JPEG entry guard', async () => {
    vi.spyOn(raster, 'renderCoverJpeg').mockRejectedValueOnce(new HttpError(503, 'busy'));
    const busy = await call('share');
    expect(busy.status).toBe(503);
    expect(busy.headers.get('Retry-After')).toBe('1');
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
    expect((await call('share')).status).toBe(200);
  });
});
