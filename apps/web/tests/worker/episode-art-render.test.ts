import { readFileSync } from 'node:fs';
import type { Miniflare } from 'miniflare';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeIds } from '../../src/shared/appearance';
import { composeCoverSvg, coverText } from '../../src/shared/cover-composition';
import worker from '../../worker';
import { loadCoverFonts } from '../../worker/cover-fonts';
import * as raster from '../../worker/cover-raster';
import { cacheablePublicRequest } from '../../worker/public-cache';
import {
  type AssetOverride,
  artRequest,
  callRouteEpisodeArt,
  coverKey,
  createEpisodeArtEnv,
  origin,
  resetEpisodeArtEnv,
} from './episode-art-fixture';
import { putR2Fixture } from './r2-fixtures';

vi.mock('@takumi-rs/wasm/takumi_wasm_bg.wasm', async () => ({
  default: new WebAssembly.Module(
    readFileSync(
      new URL('../../../../node_modules/@takumi-rs/wasm/pkg/takumi_wasm_bg.wasm', import.meta.url),
    ),
  ),
}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const source = readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url));
let mf: Miniflare;
let env: Env;
let assetOverrides: Map<string, AssetOverride>;
let assetReads: string[];

beforeAll(async () => {
  ({ mf, env, assetOverrides, assetReads } = await createEpisodeArtEnv('episode-art-render-test'));
});

beforeEach(async () => {
  await resetEpisodeArtEnv(mf, env, assetOverrides, assetReads, source);
});

afterAll(async () => {
  await mf.dispose();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('public episode JPEG real rendering', () => {
  it.each([
    ['art', 1400, 1400],
    ['share', 1200, 630],
  ] as const)('serves %s through the uncached gateway with real JPEG bytes', async (kind, width, height) => {
    const fetch = vi.fn();
    const context = { exports: { PublicContent: { fetch } } } as unknown as ExecutionContext;
    const redirect = await worker.fetch(artRequest(kind), env, context);
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
    expect(cacheablePublicRequest(artRequest(kind))).toBe(false);
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
    const stored = await env.MEDIA.get(coverKey);
    if (!stored) throw new Error('Missing original');
    expect(Buffer.from(await new Response(stored.body).arrayBuffer()).equals(source)).toBe(true);
  });

  it('renders a 3000-square output from a 1024-square original', async () => {
    const original = await sharp(source).resize(1024, 1024).jpeg().toBuffer();
    await putR2Fixture(mf, coverKey, original);
    const response = await callRouteEpisodeArt(env, 'art', '?size=3000');
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

  it.each(themeIds)('composes valid framed SVG and text layouts for %s', async (theme) => {
    const copy = { title: '下班后，慢慢来', episodeNumber: 1, categoryName: '生活' };
    const frame = readFileSync(new URL(`../../public/brand/frames/${theme}.svg`, import.meta.url), 'utf8');
    expect(frame.startsWith('<svg ')).toBe(true);
    const { families } = await loadCoverFonts(env, origin, coverText(theme, copy));
    const svg = composeCoverSvg(
      theme,
      copy,
      'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
      frame,
      families,
    );
    expect(svg).toContain('下班后，慢慢来');
    expect(svg).toContain('<image ');
  });

  it('preserves the existing stillwood framed composition', async () => {
    const theme = 'stillwood';
    await env.DB.prepare('UPDATE site_appearance SET theme = ?').bind(theme).run();
    const actual = Buffer.from(await (await callRouteEpisodeArt(env, 'art', '?size=1600')).arrayBuffer());
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
    await putR2Fixture(mf, coverKey, original);
    const actual = Buffer.from(await (await callRouteEpisodeArt(env, 'art', '?size=1600')).arrayBuffer());
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
    await putR2Fixture(mf, coverKey, original);
    const response = await callRouteEpisodeArt(env, 'share');
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
});
