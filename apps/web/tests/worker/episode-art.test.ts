import { createHash } from 'node:crypto';
import type { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { renderCoverJpeg } from '../../worker/cover-raster';
import { ensureEpisodeArt, routeEpisodeArt } from '../../worker/episode-art';
import { HttpError } from '../../worker/http';
import { cacheablePublicRequest } from '../../worker/public-cache';
import {
  type AssetOverride,
  artRequest,
  callRouteEpisodeArt,
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

const call = (kind: 'art' | 'share' = 'art', query = '', method = 'GET', bindings = env) =>
  callRouteEpisodeArt(env, kind, query, method, bindings);

function mockRenderJpeg(size = 1024) {
  const render = vi.mocked(renderCoverJpeg);
  render.mockReset().mockImplementation(async (svg) => {
    const digest = createHash('sha256').update(svg).digest();
    const out = makeMockJpeg(size);
    out.set(digest.subarray(0, Math.min(digest.length, out.length - 4)), 2);
    return out;
  });
  return render;
}

beforeAll(async () => {
  tinyWebp = await createTinyWebp();
  ({ mf, env, assetOverrides, assetReads } = await createEpisodeArtEnv('episode-art-test', {
    stubImages: true,
  }));
});

beforeEach(async () => {
  await resetEpisodeArtEnv(mf, env, assetOverrides, assetReads, tinyWebp);
});

afterAll(async () => {
  await mf.dispose();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('public episode JPEG artwork', () => {
  it('serves immutable cache hits, HEAD and conditional requests without rendering again', async () => {
    const render = mockRenderJpeg();
    const redirect = await routeEpisodeArt(artRequest('share'), env, 'one', 'share');
    const url = new URL(redirect.headers.get('Location') ?? '', origin);
    const first = await routeEpisodeArt(new Request(url), env, 'one', 'share');
    expect(first.headers.get('X-Hisfm-Art')).toBe('rendered');
    expect(render).toHaveBeenCalledTimes(1);
    const bytes = await first.arrayBuffer();
    render.mockClear();
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
      (await routeEpisodeArt(artRequest(kind), env, 'one', kind)).headers.get('Location');
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
    mockRenderJpeg();
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
    mockRenderJpeg();
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

  it('versions the saved theme and serves cached bytes without rereading originals', async () => {
    mockRenderJpeg();
    const first = Buffer.from(await (await call()).arrayBuffer());
    await env.DB.prepare("UPDATE site_appearance SET theme = 'interval'").run();
    const second = Buffer.from(await (await call()).arrayBuffer());
    expect(first.equals(second)).toBe(false);
    expect(assetReads).toContain('/brand/frames/interval.svg');
    await env.MEDIA.delete(coverKey);
    expect(Buffer.from(await (await call()).arrayBuffer()).equals(second)).toBe(true);
  });

  it('keeps share artwork independent of theme and episode copy', async () => {
    mockRenderJpeg();
    const first = Buffer.from(await (await call('share')).arrayBuffer());
    await env.DB.prepare("UPDATE site_appearance SET theme = 'grove'").run();
    await env.DB.prepare("UPDATE episodes SET title = 'Different title', episode_number = 999").run();
    const second = Buffer.from(await (await call('share')).arrayBuffer());
    expect(first.equals(second)).toBe(true);
    expect(assetReads.every((path) => path === '/brand/stillwood-wordmark.svg')).toBe(true);
  });

  it('supports bodyless HEAD with the same JPEG headers', async () => {
    mockRenderJpeg(1200);
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
      const response = await worker.fetch(artRequest(kind), env);
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
    expect(cacheablePublicRequest(artRequest('art', query))).toBe(false);
  });

  it('rejects share options, mutations and malformed encoded IDs', async () => {
    await expect(call('share', '?size=1400')).rejects.toMatchObject({ status: 400 });
    await expect(call('art', '', 'POST')).rejects.toMatchObject({ status: 405 });
    await expect(routeEpisodeArt(artRequest(), env, '%xx', 'art')).rejects.toMatchObject({ status: 400 });
    await env.DB.prepare("UPDATE episodes SET id = 'one two'").run();
    const response = await worker.fetch(artRequest('share', '', 'GET', 'one%20two'), env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/episodes/one%20two/share.jpg?v=');
  });

  it('only reads trusted sources and preserves local seed support', async () => {
    mockRenderJpeg();
    await env.DB.prepare("UPDATE episodes SET cover_url = 'https://untrusted.example/secret.jpg'").run();
    await expect(call()).rejects.toMatchObject({ status: 400 });
    await env.DB.prepare("UPDATE episodes SET cover_url = 'https://f.no.mt/images/episode-01.webp'").run();
    const response = await call('share', '', 'GET', { ...env, ENVIRONMENT: 'local' });
    expect(response.status).toBe(200);
    expect(assetReads).toContain('/images/episode-01.webp');
  });

  it('rejects oversized sources and invalid pixels, then recovers', async () => {
    mockRenderJpeg();
    const body = new ReadableStream();
    const cancel = vi.spyOn(body, 'cancel');
    const bindings = {
      ...env,
      MEDIA: { head: () => null, get: async () => ({ size: 20_000_001, body }) },
    } as unknown as Env;
    await expect(call('share', '', 'GET', bindings)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
    await env.MEDIA.put(coverKey, 'corrupt image');
    await expect(call('share')).rejects.toMatchObject({ status: 422 });
    await env.MEDIA.put(coverKey, tinyWebp, { httpMetadata: { contentType: 'image/webp' } });
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

  it('shares simultaneous same-key cache misses', async () => {
    const render = mockRenderJpeg();
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
          if (objectKey !== coverKey) return env.MEDIA.get(objectKey);
          notifyReady();
          return released;
        },
      },
    } as unknown as Env;
    const sharedHead = vi.fn((objectKey: string) => env.MEDIA.head(objectKey));
    const sharedBindings = {
      ...env,
      MEDIA: {
        head: sharedHead,
        get: (objectKey: string) => env.MEDIA.get(objectKey),
        put: (objectKey: string, value: Uint8Array, options: R2PutOptions) =>
          env.MEDIA.put(objectKey, value, options),
      },
    } as unknown as Env;
    const pending = call('share', '', 'GET', bindings);
    await ready;
    const shared = call('share', '', 'GET', sharedBindings);
    await vi.waitFor(() => expect(sharedHead).toHaveBeenCalledTimes(1));
    release(await env.MEDIA.get(coverKey));
    const responses = await Promise.all([pending, shared]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.arrayBuffer()));
    expect(Buffer.from(bodies[0]).equals(Buffer.from(bodies[1]))).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'serializes a bounded different-key queue and releases after failure=%s',
    async (fail) => {
      let release = () => {};
      let ready = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const render = vi.mocked(renderCoverJpeg);
      render.mockReset().mockImplementation(async () => {
        ready();
        await held;
        if (fail) {
          fail = false;
          throw new HttpError(422, 'invalid image');
        }
        return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      });
      const head = vi.fn(env.MEDIA.head.bind(env.MEDIA));
      const bindings = {
        ...env,
        MEDIA: {
          ...env.MEDIA,
          head,
          get: env.MEDIA.get.bind(env.MEDIA),
          put: env.MEDIA.put.bind(env.MEDIA),
        },
      };
      const coverKeys = Array.from({ length: 10 }, (_, index) => `productions/p1/queued-cover-${index}.webp`);
      await Promise.all(
        coverKeys.map((key) => env.MEDIA.put(key, tinyWebp, { httpMetadata: { contentType: 'image/webp' } })),
      );
      const recordFor = (index: number, id = `queued-${index}`) => ({
        resource: 'episodes' as const,
        id,
        title: 'Title',
        episodeNumber: 1,
        categoryName: 'Category',
        coverUrl: `https://f.no.mt/${coverKeys[index]}`,
      });
      const first = ensureEpisodeArt(bindings, origin, recordFor(0), null);
      const outcome = first.then(
        () => 200,
        (error: HttpError) => error.status,
      );
      await started;
      const queued = Array.from({ length: 7 }, (_, index) =>
        ensureEpisodeArt(bindings, origin, recordFor(index + 1), null),
      );
      await vi.waitFor(() => expect(head).toHaveBeenCalledTimes(9));
      await expect(ensureEpisodeArt(bindings, origin, recordFor(8, 'overflow'), null)).rejects.toMatchObject({
        status: 503,
      });
      expect(render).toHaveBeenCalledTimes(1);
      const expectedStatus = fail ? 422 : 200;
      release();
      expect(await outcome).toBe(expectedStatus);
      expect((await Promise.all(queued)).every(({ source }) => source === 'rendered')).toBe(true);
      expect(render).toHaveBeenCalledTimes(8);
      expect((await ensureEpisodeArt(bindings, origin, recordFor(9, 'later'), null)).source).toBe('rendered');
    },
  );

  it('preserves shared PNG renderer contention and releases the JPEG entry guard', async () => {
    vi.mocked(renderCoverJpeg)
      .mockReset()
      .mockRejectedValueOnce(new HttpError(503, 'busy'))
      .mockResolvedValueOnce(makeMockJpeg());
    const busy = await call('share');
    expect(busy.status).toBe(503);
    expect(busy.headers.get('Retry-After')).toBe('1');
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
    expect((await call('share')).status).toBe(200);
  });
});
