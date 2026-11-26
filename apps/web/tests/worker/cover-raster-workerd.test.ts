import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { rolldown } from 'rolldown';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { themeIds } from '../../src/shared/appearance';
import { composeCoverSvg, coverArtwork, coverDesignSize } from '../../src/shared/cover-composition';

const fontRoot = new URL('../../public/brand/fonts/cover/', import.meta.url);

async function pixels(png: Uint8Array) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function expectJpeg(bytes: Uint8Array, width: number, height: number) {
  expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  const metadata = await sharp(bytes).metadata();
  expect(metadata).toMatchObject({
    format: 'jpeg',
    width,
    height,
    space: 'srgb',
    channels: 3,
    hasAlpha: false,
    hasProfile: false,
  });
  expect(metadata.icc).toBeUndefined();
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
}

function ink(data: Uint8Array, width: number) {
  let count = 0;
  for (let y = 0; y < 100; y++) {
    for (let x = 100; x < 900; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset] < 100 && data[offset + 1] < 100 && data[offset + 2] < 100) count++;
    }
  }
  return count;
}

describe('deployed-like workerd WASM', { concurrent: false }, () => {
  let mf: Miniflare;
  let createWorker: () => Miniflare;

  beforeAll(async () => {
    vi.stubEnv('MINIFLARE_ASSERT_BODIES_CONSUMED', 'true');
    const raster = fileURLToPath(new URL('../../worker/cover-raster.ts', import.meta.url));
    const loader = fileURLToPath(new URL('../../worker/cover-fonts.ts', import.meta.url));
    const composition = fileURLToPath(new URL('../../src/shared/cover-composition.ts', import.meta.url));
    const share = fileURLToPath(new URL('../../src/shared/share-composition.ts', import.meta.url));
    const source = `import { renderCoverPng, renderCoverJpeg } from ${JSON.stringify(raster)};
import { loadCoverFonts } from ${JSON.stringify(loader)};
import { coverText, composeCoverSvg } from ${JSON.stringify(composition)};
import { composeShareSvg } from ${JSON.stringify(share)};
import { initSync } from '@takumi-rs/wasm';
import wasm from '@takumi-rs/wasm/takumi_wasm_bg.wasm';
globalThis.fetch = () => { throw new Error('Unexpected outbound fetch'); };
export default { async fetch(request, env) {
  const { image, imageSize, title = '中文龘', weight = 500, theme, share = false, frame, format = 'png', width = 1600, height = 1600 } = await request.json();
  const copy = { title, episodeNumber: 1, categoryName: '工作与睡眠' };
  const slots = share ? [] : theme ? coverText(theme, copy) : [{ font: 'noto-sans-sc', weight, value: title }];
  const { fonts, families } = await loadCoverFonts(env, 'https://his.fm', slots);
  const svg = share ? composeShareSvg(frame, { dataUrl: image, ...imageSize }, width, height) : theme ? composeCoverSvg(theme, copy, image, frame, families) : '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="white"/><image href="' + image + '" width="80" height="80"/><text x="100" y="70" font-family="' + families['noto-sans-sc'] + '" font-weight="' + weight + '" font-size="64">' + title + '</text></svg>';
  const bytes = format === 'jpeg' ? await renderCoverJpeg(svg, fonts, width, height) : await renderCoverPng(svg, fonts);
  return new Response(bytes, { headers: { 'Content-Type': 'image/' + format, 'X-Wasm-Bytes': String(initSync({module:wasm}).memory.buffer.byteLength) } });
} };`;
    const bundle = await rolldown({
      input: 'cover-workerd-entry',
      platform: 'neutral',
      plugins: [
        {
          name: 'cover-workerd-entry',
          resolveId(id) {
            if (id === 'cover-workerd-entry') return '\0cover-workerd-entry';
            if (id.endsWith('.wasm')) return { id: './cover-test.wasm', external: true };
          },
          load(id) {
            if (id === '\0cover-workerd-entry') return source;
          },
        },
      ],
    });
    const output = await bundle.generate({ format: 'esm' });
    await bundle.close();
    const entry = output.output.find((item) => item.type === 'chunk' && item.isEntry);
    if (!entry) throw new Error('Missing Worker test entry');
    const modules: Record<string, { type: 'esm' | 'wasm'; contents: string | Uint8Array<ArrayBuffer> }> = {
      'cover-test.wasm': {
        type: 'wasm',
        contents: readFileSync(
          new URL('../../../../node_modules/@takumi-rs/wasm/pkg/takumi_wasm_bg.wasm', import.meta.url),
        ),
      },
    };
    for (const chunk of output.output) {
      if (chunk.type === 'chunk') modules[chunk.fileName] = { type: 'esm', contents: chunk.code };
    }
    createWorker = () =>
      new Miniflare({
        telemetry: { enabled: false },
        workers: [
          {
            config: {
              name: 'cover-raster-test',
              compatibilityDate: '2026-09-24',
              compatibilityFlags: ['nodejs_compat'],
              manifest: { mainModule: entry.fileName, modules },
              env: {
                ASSETS: {
                  type: 'fetcher',
                  handler: (request) => {
                    const filename = new URL(request.url).pathname.split('/').at(-1) ?? '';
                    const bytes = readFileSync(new URL(filename, fontRoot));
                    return new MiniflareResponse(new Uint8Array(bytes), {
                      headers: { 'Content-Length': String(bytes.byteLength) },
                    });
                  },
                },
              },
            },
          },
        ],
      });
    mf = createWorker();
  }, 20_000);

  afterAll(async () => {
    await mf?.dispose();
    vi.unstubAllEnvs();
  });

  it.each(['png', 'jpeg', 'webp'] as const)(
    'renders embedded %s and CJK using the shipped WASM with no fetch',
    async (format) => {
      const artwork = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ff0000' } })
        .toFormat(format)
        .toBuffer();
      const response = await mf.dispatchFetch('https://his.fm/cover-proof', {
        method: 'POST',
        body: JSON.stringify({ image: `data:image/${format};base64,${artwork.toString('base64')}` }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      const { data, info } = await pixels(new Uint8Array(await response.arrayBuffer()));
      expect([info.width, info.height]).toEqual([1600, 1600]);
      const offset = (5 * info.width + 5) * 4;
      expect(data[offset]).toBeGreaterThan(240);
      expect(data[offset + 1]).toBeLessThan(15);
      expect(data[offset + 2]).toBeLessThan(15);
      expect(ink(data, info.width)).toBeGreaterThan(100);
    },
    10_000,
  );

  it.each(themeIds)('composes bounded wide Latin and Chinese SVG slots for %s', (theme) => {
    const frame = readFileSync(new URL(`../../public/brand/frames/${theme}.svg`, import.meta.url), 'utf8');
    const svg = composeCoverSvg(
      theme,
      {
        title: '从 WWDC 到 MWC：我们为什么总在期待下一个改变世界的产品龘',
        episodeNumber: 1,
        categoryName: '工作与睡眠',
      },
      'data:image/webp;base64,AA==',
      frame,
    );
    expect(svg).toContain('WWDC');
    expect(svg).toContain('<text ');
  });

  it('renders the real stillwood composition with bounded wide Latin and Chinese titles', async () => {
    const theme = 'stillwood';
    const artwork = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#99aa88' } })
      .webp()
      .toBuffer();
    const frame = readFileSync(new URL(`../../public/brand/frames/${theme}.svg`, import.meta.url), 'utf8');
    const response = await mf.dispatchFetch('https://his.fm/cover-proof', {
      method: 'POST',
      body: JSON.stringify({
        theme,
        frame,
        image: `data:image/webp;base64,${artwork.toString('base64')}`,
        title: '从 WWDC 到 MWC：我们为什么总在期待下一个改变世界的产品龘',
      }),
    });
    expect(response.status).toBe(200);
    const png = new Uint8Array(await response.arrayBuffer());
    const info = await sharp(png).metadata();
    expect([info.width, info.height]).toEqual([1600, 1600]);
    expect(png.length).toBeGreaterThan(10_000);
    const blank = await mf.dispatchFetch('https://his.fm/cover-proof', {
      method: 'POST',
      body: JSON.stringify({
        theme,
        frame,
        image: `data:image/webp;base64,${artwork.toString('base64')}`,
        title: '',
      }),
    });
    expect(blank.status).toBe(200);
    const blankPng = new Uint8Array(await blank.arrayBuffer());
    const { data } = await pixels(png);
    const { data: background } = await pixels(blankPng);
    let titleRight = 0;
    for (let y = 1250; y < 1600; y++) {
      for (let x = 0; x < 1600; x++) {
        const offset = (y * 1600 + x) * 4;
        if (
          data[offset] !== background[offset] ||
          data[offset + 1] !== background[offset + 1] ||
          data[offset + 2] !== background[offset + 2]
        )
          titleRight = Math.max(titleRight, x);
      }
    }
    expect(titleRight).toBeGreaterThan(100);
    expect(titleRight).toBeLessThanOrEqual(Math.ceil((844 / 1024) * 1600));
  }, 10_000);

  it('bounds real-layout WASM memory with a high-entropy jpeg source', async () => {
    const size = 2000;
    const artwork = await sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: '#000000',
        noise: { type: 'gaussian', mean: 128, sigma: 64 },
      },
    })
      .toFormat('jpeg')
      .toBuffer();
    expect(artwork.byteLength).toBeLessThan(4 * 1024 * 1024);
    const frame = readFileSync(
      new URL('../../public/brand/frames/soft-landing.svg', import.meta.url),
      'utf8',
    );
    const response = await mf.dispatchFetch('https://his.fm/cover-proof', {
      method: 'POST',
      body: JSON.stringify({
        image: `data:image/jpeg;base64,${artwork.toString('base64')}`,
        title: '下班后，还要追多少个 AI？龘',
        theme: 'soft-landing',
        frame,
      }),
    });
    expect(response.status).toBe(200);
    const wasmBytes = Number(response.headers.get('X-Wasm-Bytes'));
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
    expect(wasmBytes).toBeLessThan(96 * 1024 * 1024);
  }, 10_000);

  it.each([
    [1200, 630, null],
    [1400, 1400, 'stillwood'],
  ] as const)(
    'renders real JPEG artwork at %ix%i (%s) with crop-sized input below Workers 128 MiB',
    async (width, height, theme) => {
      const art = theme ? coverArtwork(theme) : null;
      const crop = art
        ? {
            width: Math.ceil((width * art.width) / coverDesignSize),
            height: Math.ceil((height * art.height) / coverDesignSize),
          }
        : { width: 1600, height: 1600 };
      const artwork = await sharp(
        readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
      )
        .resize(crop.width, crop.height, { fit: 'cover' })
        .webp({ quality: 95 })
        .toBuffer();
      expect(await sharp(artwork).metadata()).toMatchObject(crop);
      const frame = readFileSync(
        new URL(
          theme ? `../../public/brand/frames/${theme}.svg` : '../../public/brand/stillwood-wordmark.svg',
          import.meta.url,
        ),
        'utf8',
      );
      const response = await mf.dispatchFetch('https://his.fm/cover-proof', {
        method: 'POST',
        body: JSON.stringify({
          format: 'jpeg',
          width,
          height,
          theme,
          share: !theme,
          imageSize: crop,
          frame,
          title: '从 WWDC 到 MWC：下班后，还要追多少个 AI？龘',
          image: `data:image/webp;base64,${artwork.toString('base64')}`,
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/jpeg');
      const bytes = new Uint8Array(await response.arrayBuffer());
      await expectJpeg(bytes, width, height);
      expect(bytes.byteLength).toBeGreaterThan(10_000);
      const wasmBytes = Number(response.headers.get('X-Wasm-Bytes'));
      expect(wasmBytes).toBeGreaterThan(0);
      expect(wasmBytes).toBeLessThan(128 * 1024 * 1024);
    },
    20_000,
  );

  it('bounds a real 1600-square stillwood JPEG composition below 96 MiB in cold workerd', async () => {
    const art = coverArtwork('stillwood');
    const crop = {
      width: Math.ceil((1600 * art.width) / coverDesignSize),
      height: Math.ceil((1600 * art.height) / coverDesignSize),
    };
    const artwork = await sharp(readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)))
      .resize(crop.width, crop.height, { fit: 'cover' })
      .webp({ quality: 95 })
      .toBuffer();
    expect(await sharp(artwork).metadata()).toMatchObject(crop);
    const frame = readFileSync(new URL('../../public/brand/frames/stillwood.svg', import.meta.url), 'utf8');
    const worker = createWorker();
    try {
      const response = await worker.dispatchFetch('https://his.fm/cover-proof', {
        method: 'POST',
        body: JSON.stringify({
          format: 'jpeg',
          width: 1600,
          height: 1600,
          theme: 'stillwood',
          frame,
          image: `data:image/webp;base64,${artwork.toString('base64')}`,
          title: '从 WWDC 到 MWC：下班后，还要追多少个 AI？龘',
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/jpeg');
      const jpeg = new Uint8Array(await response.arrayBuffer());
      await expectJpeg(jpeg, 1600, 1600);
      expect(jpeg.byteLength).toBeGreaterThan(10_000);
      const stats = await sharp(jpeg).stats();
      expect(stats.channels.every((channel) => channel.stdev > 10)).toBe(true);
      const wasmBytes = Number(response.headers.get('X-Wasm-Bytes'));
      expect(wasmBytes).toBeGreaterThan(0);
      expect(wasmBytes).toBeLessThanOrEqual(96 * 1024 * 1024);
    } finally {
      await worker.dispose();
    }
  }, 20_000);
});
