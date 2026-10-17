import { readFileSync } from 'node:fs';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeIds } from '../../src/shared/appearance';
import { composeCoverSvg, coverText } from '../../src/shared/cover-composition';
import worker from '../../worker';
import { loadCoverFonts } from '../../worker/cover-fonts';
import { renderCoverPng } from '../../worker/cover-raster';
import { routeEpisodeArt } from '../../worker/episode-art';
import { cacheablePublicRequest } from '../../worker/public-cache';

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
const call = (kind: 'art' | 'share' = 'art', query = '', method = 'GET', bindings = env) =>
  routeEpisodeArt(request(kind, query, method), bindings, 'one', kind);

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
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
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
  await env.MEDIA.put(key, source);
});
afterAll(() => mf.dispose());
afterEach(() => vi.restoreAllMocks());

describe('public episode JPEG artwork', () => {
  it.each([
    ['art', 1400, 1400],
    ['share', 1200, 630],
  ] as const)('serves %s through the uncached gateway with real JPEG bytes', async (kind, width, height) => {
    const fetch = vi.fn();
    const context = { exports: { PublicContent: { fetch } } } as unknown as ExecutionContext;
    const response = await worker.fetch(request(kind), env, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('ETag')).toBe(false);
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
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(source);
  });

  it('accepts size bounds and higher-resolution originals beyond PNG export limits', async () => {
    const original = await sharp(source).resize(3000, 3000).jpeg().toBuffer();
    await env.MEDIA.put(key, original);
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
  });

  it.each(themeIds)('preserves the existing %s framed composition', async (theme) => {
    await env.DB.prepare('UPDATE site_appearance SET theme = ?').bind(theme).run();
    const actual = Buffer.from(await (await call('art', '?size=1600')).arrayBuffer());
    const copy = { title: '下班后，慢慢来', episodeNumber: 1, categoryName: '生活' };
    const { fonts, families } = await loadCoverFonts(env, origin, coverText(theme, copy));
    const frame = readFileSync(new URL(`../../public/brand/frames/${theme}.svg`, import.meta.url), 'utf8');
    const expected = await renderCoverPng(
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

  it('uses the saved theme and reads fresh sources on every request', async () => {
    const first = Buffer.from(await (await call()).arrayBuffer());
    await env.DB.prepare("UPDATE site_appearance SET theme = 'interval'").run();
    const second = Buffer.from(await (await call()).arrayBuffer());
    expect(first.equals(second)).toBe(false);
    expect(assetReads).toContain('/brand/frames/interval.svg');
    await env.MEDIA.delete(key);
    await expect(call()).rejects.toMatchObject({ status: 404 });
  });

  it('keeps share artwork independent of theme and episode copy', async () => {
    const first = Buffer.from(await (await call('share')).arrayBuffer());
    await env.DB.prepare("UPDATE site_appearance SET theme = 'grove'").run();
    await env.DB.prepare("UPDATE episodes SET title = 'Different title', episode_number = 999").run();
    const second = Buffer.from(await (await call('share')).arrayBuffer());
    expect(first).toEqual(second);
    expect(assetReads.every((path) => path === '/brand/stillwood-wordmark.svg')).toBe(true);
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

  it.each(['?size=1399', '?size=3001', '?size=1500.5', '?size=', '?theme=grove', '?size=1400&size=1400'])(
    'rejects invalid or duplicate options %s',
    async (query) => {
      await expect(call('art', query)).rejects.toMatchObject({ status: 400 });
      expect(cacheablePublicRequest(request('art', query))).toBe(false);
    },
  );

  it('rejects share options, mutations and malformed encoded IDs', async () => {
    await expect(call('share', '?size=1400')).rejects.toMatchObject({ status: 400 });
    await expect(call('art', '', 'POST')).rejects.toMatchObject({ status: 405 });
    await expect(routeEpisodeArt(request(), env, '%xx', 'art')).rejects.toMatchObject({ status: 400 });
    await env.DB.prepare("UPDATE episodes SET id = 'one two'").run();
    const response = await worker.fetch(request('share', '', 'GET', 'one%20two'), env);
    expect(response.status).toBe(200);
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
    const bindings = { ...env, MEDIA: { get: async () => ({ size: 20_000_001, body }) } } as unknown as Env;
    await expect(call('share', '', 'GET', bindings)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
    await env.MEDIA.put(key, 'corrupt image');
    await expect(call('share')).rejects.toMatchObject({ status: 422 });
    await env.MEDIA.put(key, source);
    expect((await call('share')).status).toBe(200);
  });

  it('fails explicitly for unavailable or malformed frame and local source assets', async () => {
    const path = '/brand/stillwood-wordmark.svg';
    assetOverrides.set(path, { body: 'missing', status: 404 });
    await expect(call('share')).rejects.toMatchObject({ status: 503 });
    assetOverrides.set(path, { body: 'invalid' });
    await expect(call('share')).rejects.toMatchObject({ status: 503 });
    assetOverrides.clear();
    await env.DB.prepare("UPDATE episodes SET cover_url = '/images/missing.png'").run();
    await expect(call('share')).rejects.toMatchObject({ status: 404 });
    assetOverrides.set('/images/missing.png', { body: '', headers: { 'Content-Length': '20000001' } });
    await expect(call('share')).rejects.toMatchObject({ status: 413 });
  });

  it('bounds simultaneous composition without caching or queuing', async () => {
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
        get: () => {
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
});
