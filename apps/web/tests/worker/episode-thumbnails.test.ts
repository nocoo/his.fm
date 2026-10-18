import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeIds } from '../../src/shared/appearance';
import { coverArtwork } from '../../src/shared/cover-composition';
import { episodeThumbnailWidths } from '../../src/shared/episode-thumbnail';
import { routeEpisodeThumbnail } from '../../worker/episode-thumbnails';
import { coverDimensions } from '../../worker/media-validation';
import { putR2Fixture, r2FixtureWorker } from './r2-fixtures';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let mf: Miniflare;
let env: Env;
const source = readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url));
const key = 'productions/one/cover.webp';
const request = (method = 'GET', query = '') =>
  new Request(`https://his.fm/media/episode-thumbnails/one/3/stillwood/320.webp${query}`, { method });
const call = (method = 'GET', version = '3', width = '320', query = '', bindings = env) =>
  routeEpisodeThumbnail(request(method, query), bindings, 'one', version, 'stillwood', width);

beforeAll(async () => {
  mf = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'episode-thumbnail-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: r2FixtureWorker },
            },
          },
          env: {
            DB: { type: 'd1', name: 'episode-thumbnail-test' },
            MEDIA: { type: 'r2', name: 'episode-thumbnail-test' },
            IMAGES: { type: 'images', dev: { remote: false } },
            MEDIA_BASE_URL: { type: 'json', value: 'https://f.no.mt' },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  await env.DB.prepare(
    'CREATE TABLE episodes (id TEXT PRIMARY KEY, cover_url TEXT, version INTEGER, status TEXT, published_at TEXT)',
  ).run();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM episodes').run();
  await env.DB.prepare('INSERT INTO episodes VALUES (?, ?, ?, ?, ?)')
    .bind('one', `https://f.no.mt/${key}`, 3, 'published', '2020-01-01T00:00:00.000Z')
    .run();
  await putR2Fixture(mf, key, source);
});

afterAll(() => mf.dispose());
afterEach(() => vi.restoreAllMocks());

describe('published episode thumbnails', () => {
  it('resizes through the native local Images binding, preserves originals and sends fixed WebP', async () => {
    for (const width of episodeThumbnailWidths) {
      const response = await call('GET', '3', String(width));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/webp');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.has('Vary')).toBe(false);
      const output = new Uint8Array(await response.arrayBuffer());
      const dimensions = coverDimensions(output);
      expect(dimensions.width).toBe(width);
      expect(dimensions.height).toBe(width);
      if (width <= 640) expect(output.byteLength).toBeLessThan(source.byteLength);
    }
    const original = await env.MEDIA.get(key);
    if (!original) throw new Error('Missing original');
    expect(Buffer.from(await new Response(original.body).arrayBuffer()).equals(source)).toBe(true);
  });

  it('keeps valid HEAD bodyless without running a transformation', async () => {
    const input = vi.fn();
    const response = await call('HEAD', '3', '320', '', {
      ...env,
      IMAGES: { input } as unknown as ImagesBinding,
    });
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(await response.text()).toBe('');
    expect(input).not.toHaveBeenCalled();
  });

  it('matches each approved artwork window crop and supplies full pixels for nonsquare originals', async () => {
    const rectangular = await env.IMAGES.input(new Blob([source]).stream())
      .transform({ width: 640, height: 320, fit: 'cover' })
      .output({ format: 'image/png' });
    await putR2Fixture(mf, key, new Uint8Array(await rectangular.response().arrayBuffer()));
    for (const theme of themeIds) {
      const response = await routeEpisodeThumbnail(request(), env, 'one', '3', theme, '160');
      const artwork = coverArtwork(theme);
      expect(coverDimensions(new Uint8Array(await response.arrayBuffer()))).toEqual({
        width: 160,
        height: Math.round((160 * artwork.height) / artwork.width),
      });
    }
    const stored = await env.MEDIA.get(key);
    if (!stored) throw new Error('Missing original');
    expect(coverDimensions(new Uint8Array(await new Response(stored.body).arrayBuffer()))).toEqual({
      width: 640,
      height: 320,
    });
  });

  it('does not expose drafts, future publication, stale versions or missing episodes', async () => {
    await expect(call('GET', '2')).rejects.toMatchObject({ status: 404 });
    for (const [status, date] of [
      ['draft', '2020-01-01T00:00:00.000Z'],
      ['published', '2999-01-01T00:00:00.000Z'],
    ]) {
      await env.DB.prepare('UPDATE episodes SET status = ?, published_at = ?').bind(status, date).run();
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
    await env.DB.prepare('DELETE FROM episodes').run();
    await expect(call()).rejects.toMatchObject({ status: 404 });
  });

  it('rejects unbounded, noncanonical or unknown transformation options before storage access', async () => {
    for (const width of ['0', '1', '320.0', '0320', '321', '99999', '320.webp', '-320'])
      await expect(call('GET', '3', width)).rejects.toMatchObject({ status: 400 });
    for (const version of ['0', '-1', '03', '3.0', '1e1', '9007199254740992', 'NaN'])
      await expect(call('GET', version)).rejects.toMatchObject({ status: 400 });
    for (const theme of ['', 'unknown', 'STILLWOOD', 'stillwood?width=10000'])
      await expect(routeEpisodeThumbnail(request(), env, 'one', '3', theme, '320')).rejects.toMatchObject({
        status: 400,
      });
    for (const query of ['?width=999999', '?url=https://elsewhere.test/private', '?format=jpeg', '?v=3'])
      await expect(call('GET', '3', '320', query)).rejects.toMatchObject({ status: 400 });
    for (const method of ['POST', 'PUT', 'DELETE'])
      await expect(call(method)).rejects.toMatchObject({ status: 405 });
  });

  it('reads only a published configured R2 cover, never arbitrary remote or asset URLs', async () => {
    for (const cover of [
      'https://elsewhere.test/secret.png',
      '/images/cover.webp',
      'https://f.no.mt/cover.webp?width=1',
    ]) {
      await env.DB.prepare('UPDATE episodes SET cover_url = ?').bind(cover).run();
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
    await env.DB.prepare('UPDATE episodes SET cover_url = ?').bind('/media/missing.webp').run();
    await expect(call()).rejects.toMatchObject({ status: 404 });
    await env.DB.prepare('UPDATE episodes SET cover_url = ?').bind(`/media/${key}`).run();
    expect((await call('HEAD')).status).toBe(200);
  });

  it('optimizes valid published originals beyond the separate PNG-export byte and pixel guards', async () => {
    const jpeg = await sharp({
      create: { width: 3000, height: 3000, channels: 3, background: '#235844' },
    })
      .jpeg()
      .toBuffer();
    const png = await sharp({
      create: { width: 1280, height: 1280, channels: 4, background: '#235844' },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(jpeg.byteLength).toBeLessThan(4 * 1024 * 1024);
    expect(png.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(png.byteLength).toBeLessThan(8 * 1024 * 1024);
    for (const original of [jpeg, png]) {
      await putR2Fixture(mf, key, original);
      const response = await call();
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/webp');
      expect(coverDimensions(new Uint8Array(await response.arrayBuffer()))).toEqual({
        width: 320,
        height: 320,
      });
      const stored = await env.MEDIA.get(key);
      if (!stored) throw new Error('Missing original');
      expect(Buffer.from(await new Response(stored.body).arrayBuffer()).equals(original)).toBe(true);
    }
  });

  it('preserves oversized originals without buffering or transforming beyond the native input limit', async () => {
    await putR2Fixture(mf, key, new Uint8Array(20_000_001));
    const input = vi.fn();
    for (const method of ['GET', 'HEAD']) {
      const response = await call(method, '3', '320', '', {
        ...env,
        IMAGES: { input } as unknown as ImagesBinding,
      });
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(`https://f.no.mt/${key}`);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Thumbnail-Status')).toBe('original');
      expect(await response.text()).toBe('');
    }
    expect(input).not.toHaveBeenCalled();
    expect((await env.MEDIA.head(key))?.size).toBe(20_000_001);
  });

  it('uses fixed native parameters and keeps a trusted original available when Images fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const output = vi.fn().mockRejectedValue(new Error('Images unavailable'));
    const transform = vi.fn().mockReturnValue({ output });
    const input = vi.fn().mockReturnValue({ transform });
    const response = await call('GET', '3', '320', '', {
      ...env,
      IMAGES: { input } as unknown as ImagesBinding,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`https://f.no.mt/${key}`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('episode_thumbnail_failed'));
    expect(transform).toHaveBeenCalledWith({ width: 320, height: 320, fit: 'cover' });
    expect(output).toHaveBeenCalledWith({ format: 'image/webp', quality: 80, anim: false });
    expect(Buffer.from(await new Response(input.mock.calls[0][0]).arrayBuffer()).equals(source)).toBe(true);
  });

  it('never caches or labels a non-WebP or failed native response as a successful thumbnail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const response of [
      new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
      new Response('failure', { status: 503, headers: { 'Content-Type': 'image/webp' } }),
      new Response(null, { headers: { 'Content-Type': 'image/png' } }),
    ]) {
      const images = {
        input: () => ({ transform: () => ({ output: async () => ({ response: () => response }) }) }),
      } as unknown as ImagesBinding;
      await env.DB.prepare('UPDATE episodes SET cover_url = ?').bind(`/media/${key}`).run();
      const result = await call('GET', '3', '320', '', { ...env, IMAGES: images });
      expect(result.status).toBe(302);
      expect(result.headers.get('Location')).toBe(`https://his.fm/media/${key}`);
      expect(result.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});
