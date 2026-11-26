import { createHash } from 'node:crypto';
import type { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { artLocation } from '../../src/shared/episode-art';
import worker from '../../worker';
import { renderCoverJpeg } from '../../worker/cover-raster';
import { routeEpisodeArt } from '../../worker/episode-art';
import { HttpError } from '../../worker/http';
import {
  type AssetOverride,
  artRequest,
  coverKey,
  createEpisodeArtEnv,
  createTinyWebp,
  makeMockJpeg,
  origin,
  resetEpisodeArtEnv,
} from './episode-art-fixture';

vi.mock('../../worker/cover-raster', () => ({
  renderCoverJpeg: vi.fn(),
  renderCoverPng: vi.fn(),
}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let mf: Miniflare;
let env: Env;
let assetOverrides: Map<string, AssetOverride>;
let assetReads: string[];
let tinyWebp: Buffer;

beforeAll(async () => {
  tinyWebp = await createTinyWebp();
  ({ mf, env, assetOverrides, assetReads } = await createEpisodeArtEnv('episode-art-edge-cache-test'));
});

beforeEach(async () => {
  await resetEpisodeArtEnv(mf, env, assetOverrides, assetReads);
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
        coverUrl: `https://f.no.mt/${coverKey}`,
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
        coverUrl: `https://f.no.mt/${coverKey}`,
      };
      const oldVersion = createHash('sha256')
        .update(JSON.stringify(['jpeg-v1', record.coverUrl, theme, record.title, 1, '生活']))
        .digest('hex');
      const oldRequest = artRequest('art', `?v=${oldVersion}`);
      await edge.put(oldRequest, new Response(bytes));
      await env.MEDIA.put(`rendered/art/${theme}/${oldVersion}/1400.jpg`, bytes);
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
      const render = vi.mocked(renderCoverJpeg);
      render.mockClear();
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

  it.each([
    ['bytes=0-1', 206, 'bytes 0-1/4', [0xff, 0xd8]],
    ['bytes=1-', 206, 'bytes 1-3/4', [0xd8, 0xff, 0xd9]],
    ['bytes=-2', 206, 'bytes 2-3/4', [0xff, 0xd9]],
    ['bytes=0-99', 206, 'bytes 0-3/4', [0xff, 0xd8, 0xff, 0xd9]],
    ['bytes=4-', 416, 'bytes */4', []],
    ['bytes=2-1', 416, 'bytes */4', []],
    ['bytes=-0', 416, 'bytes */4', []],
    ['bytes=0-1,2-3', 416, 'bytes */4', []],
    ['invalid', 416, 'bytes */4', []],
  ])('serves isolated GET ranges: %s', async (range, status, contentRange, expected) => {
    const url = await pregenerated('share');
    await (await routeEpisodeArt(new Request(url), env, 'one', 'share')).arrayBuffer();
    const response = await routeEpisodeArt(
      new Request(url, { headers: { Range: range } }),
      env,
      'one',
      'share',
    );
    expect(response.status).toBe(status);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Range')).toBe(contentRange);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expected);
    expect(response.headers.get('Content-Length')).toBe(status === 206 ? String(expected.length) : null);
    const full = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    expect(full.status).toBe(200);
    expect(full.headers.get('X-Hisfm-Art')).toBe('edge-hit');
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
  });

  it('does not cache cold partial responses and ignores Range on HEAD', async () => {
    const url = await pregenerated('share');
    const partial = await routeEpisodeArt(
      new Request(url, { headers: { Range: 'bytes=0-1' } }),
      env,
      'one',
      'share',
    );
    expect(partial.status).toBe(206);
    await partial.arrayBuffer();
    expect(await edge.match(url.href)).toBeUndefined();
    for (const warm of [false, true]) {
      if (warm) await (await routeEpisodeArt(new Request(url), env, 'one', 'share')).arrayBuffer();
      const response = await routeEpisodeArt(
        new Request(url, { method: 'HEAD', headers: { Range: 'bytes=0-1' } }),
        env,
        'one',
        'share',
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Length')).toBe('4');
      expect(response.headers.has('Content-Range')).toBe(false);
      expect(await response.text()).toBe('');
    }
  });

  it('honors strong If-Range validators and conditional precedence', async () => {
    const url = await pregenerated('share');
    const full = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    await full.arrayBuffer();
    const etag = full.headers.get('ETag') ?? '';
    for (const [validator, status] of [
      [etag, 206],
      [full.headers.get('Last-Modified') ?? '', 206],
      ['Fri, 01 Jan 2100 00:00:00 GMT', 206],
      [`W/${etag}`, 200],
      ['"other"', 200],
      ['Wed, 01 Jan 2020 00:00:00 GMT', 200],
      ['invalid', 200],
    ] as const) {
      const response = await routeEpisodeArt(
        new Request(url, { headers: { Range: 'bytes=-2', 'If-Range': validator } }),
        env,
        'one',
        'share',
      );
      expect(response.status).toBe(status);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(status === 206 ? bytes.slice(2) : bytes);
    }
    const conditional = await routeEpisodeArt(
      new Request(url, { headers: { Range: 'bytes=99-', 'If-None-Match': etag } }),
      env,
      'one',
      'share',
    );
    expect(conditional.status).toBe(304);
    expect(conditional.headers.has('Content-Length')).toBe(false);
    expect(await conditional.text()).toBe('');
  });

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
    await env.MEDIA.put(coverKey, tinyWebp, { httpMetadata: { contentType: 'image/webp' } });
    vi.mocked(renderCoverJpeg).mockResolvedValueOnce(makeMockJpeg(32));
    const redirect = await routeEpisodeArt(artRequest('share'), env, 'one', 'share');
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
    const redirect = await routeEpisodeArt(artRequest('share'), env, 'one', 'share');
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
        headers: { Cookie: 'private=session', Authorization: 'Bearer private' },
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
