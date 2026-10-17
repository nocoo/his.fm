import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Renderer } from '@takumi-rs/wasm';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { rolldown } from 'rolldown';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import manifest from '../../public/brand/fonts/cover/manifest.json';
import { coverArtwork, coverDesignSize, coverText } from '../../src/shared/cover-composition';
import { loadCoverFonts } from '../../worker/cover-fonts';
import { renderCoverJpeg, renderCoverPng } from '../../worker/cover-raster';

vi.mock('@takumi-rs/wasm/takumi_wasm_bg.wasm', async () => {
  const { readFileSync } = await import('node:fs');
  return {
    default: new WebAssembly.Module(
      readFileSync(
        new URL('../../../../node_modules/@takumi-rs/wasm/pkg/takumi_wasm_bg.wasm', import.meta.url),
      ),
    ),
  };
});

const fontRoot = new URL('../../public/brand/fonts/cover/', import.meta.url);
const slots = (font: string, weight: number, value: string) => [
  { ...coverText('interval', { title: '测试' })[0], font, weight, value },
];
const assets = () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return new Response(readFileSync(new URL(url.pathname.split('/').at(-1) ?? '', fontRoot)));
  });
  return { env: { ASSETS: { fetch } } as unknown as Pick<Env, 'ASSETS'>, fetch };
};
const svg = (family: string, text = '中文龘', weight = 500, image = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="white"/>${image}<text x="100" y="70" font-family="${family}" font-weight="${weight}" font-size="64">${text}</text></svg>`;

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

afterEach(() => vi.restoreAllMocks());

describe('cover font selection', () => {
  it('loads only required static shards, deduplicates bytes and returns explicit aliases', async () => {
    const { env, fetch } = assets();
    const requested = slots('noto-sans-sc', 500, '中文龘中文');
    const loaded = await loadCoverFonts(env, 'https://his.fm/admin', [...requested, ...requested]);
    expect(loaded.fonts.length).toBeGreaterThan(1);
    expect(loaded.fonts.length).toBeLessThan(5);
    expect(fetch).toHaveBeenCalledTimes(loaded.fonts.length);
    expect(Object.keys(loaded.families)).toEqual(['noto-sans-sc']);
    expect(loaded.families['noto-sans-sc']).toContain('Noto Sans SC Cover ');
    expect(loaded.fonts.reduce((sum, bytes) => sum + bytes.length, 0)).toBeLessThan(2 * 1024 * 1024);
    for (const [request] of fetch.mock.calls) {
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).url).toMatch(
        /^https:\/\/his\.fm\/brand\/fonts\/cover\/noto-sans-sc-\d+-500-[a-f0-9]+\.woff2$/,
      );
    }
  });

  it('does not read assets for empty text', async () => {
    const { env, fetch } = assets();
    expect(await loadCoverFonts(env, 'https://his.fm', [])).toEqual({ fonts: [], families: {} });
    expect(await loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, ''))).toEqual({
      fonts: [],
      families: {},
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', 500, '中', '封面字体配置无效'],
    ['noto-sans-sc', 123, '中', '封面字体字重配置无效'],
    ['noto-sans-sc', 500, '\u{10ffff}', '封面字体不包含字符'],
  ])('rejects unsupported font input %s/%i', async (font, weight, value, message) => {
    const { env, fetch } = assets();
    await expect(loadCoverFonts(env, 'https://his.fm', slots(font, weight, value))).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized selection before reading any assets', async () => {
    const { env, fetch } = assets();
    const value = manifest.fonts[0].shards.map((shard) => String.fromCodePoint(shard.ranges[0][0])).join('');
    await expect(loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, value))).rejects.toThrow(
      '超出限制',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on missing and truncated static assets', async () => {
    const { env, fetch } = assets();
    fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, '中'))).rejects.toThrow(
      '暂时无法加载',
    );
    fetch.mockResolvedValueOnce(new Response(new Uint8Array([0])));
    await expect(loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, '中'))).rejects.toThrow(
      '文件不完整',
    );
  });

  it('rejects oversized declared asset lengths before reading', async () => {
    const { env, fetch } = assets();
    fetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0]), { headers: { 'Content-Length': String(2 * 1024 * 1024) } }),
    );
    await expect(
      loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, 'A')),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('cancels a streamed font as soon as it exceeds its exact manifest length', async () => {
    const { env, fetch } = assets();
    const limit = manifest.fonts[0].shards[0].faces.find((face) => face.weight === 500)?.bytes ?? 0;
    expect(limit).toBeGreaterThan(0);
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(pulls++ === 0 ? limit : 1));
      },
      cancel,
    });
    fetch.mockResolvedValueOnce(new Response(body));
    await expect(
      loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, 'A')),
    ).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('propagates binding failures without external fetch fallback', async () => {
    const { env, fetch } = assets();
    fetch.mockRejectedValueOnce(new Error('Assets unavailable'));
    await expect(loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, '中'))).rejects.toThrow(
      'Assets unavailable',
    );
  });

  it('includes every layout weight as a genuine static face', async () => {
    const { env } = assets();
    await renderCoverPng(svg('sans-serif', ''), []);
    const renderer = new Renderer();
    try {
      for (const font of manifest.fonts) {
        for (const face of font.shards[0].faces) {
          const loaded = await loadCoverFonts(env, 'https://his.fm', slots(font.id, face.weight, 'A'));
          const families = await renderer.registerFont(loaded.fonts[0]);
          expect(
            families.flatMap((family: { faces: { weight: number }[] }) =>
              family.faces.map((face) => face.weight),
            ),
          ).toContain(face.weight);
        }
      }
    } finally {
      renderer.free();
    }
  });
});

describe('cover raster lifetime', () => {
  it.each([
    [1200, 630],
    [1400, 1400],
  ])('renders a real %ix%i sRGB JPEG without alpha, ICC or EXIF', async (width, height) => {
    const { env } = assets();
    const loaded = await loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, '中文龘'));
    const document = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><rect x="32" y="32" width="160" height="160" fill="#ff0000"/><text x="250" y="120" font-family="${loaded.families['noto-sans-sc']}" font-weight="500" font-size="64">中文龘</text></svg>`;
    const jpeg = await renderCoverJpeg(document, loaded.fonts, width, height);
    await expectJpeg(jpeg, width, height);
    const red = await sharp(jpeg).extract({ left: 64, top: 64, width: 1, height: 1 }).raw().toBuffer();
    expect(red[0]).toBeGreaterThan(240);
    expect(red[1]).toBeLessThan(15);
    expect(red[2]).toBeLessThan(15);
    const text = await sharp(jpeg).extract({ left: 250, top: 40, width: 250, height: 100 }).stats();
    expect(text.channels[0].min).toBeLessThan(30);
  });

  it('selects the requested family even when a different Latin face is registered first', async () => {
    const { env } = assets();
    const title = 'WWDC MWC 中文';
    const requested = slots('noto-sans-sc', 400, title);
    const alone = await loadCoverFonts(env, 'https://his.fm', requested);
    const mixed = await loadCoverFonts(env, 'https://his.fm', [
      ...slots('space-grotesk', 500, '001'),
      ...requested,
    ]);
    expect(mixed.families['noto-sans-sc']).toMatch(/^'Noto Sans SC Cover \d+'(?:, '.+')*$/);
    const render = (loaded: typeof alone) =>
      renderCoverPng(svg(loaded.families['noto-sans-sc'], title, 400), loaded.fonts);
    expect(Buffer.from(await render(mixed))).toEqual(Buffer.from(await render(alone)));
  });

  it('renders cross-shard CJK and distinguishes actual static weights', async () => {
    const { env } = assets();
    const hashes = [];
    const free = vi.spyOn(Renderer.prototype, 'free');
    for (const weight of [500, 650, 850]) {
      const loaded = await loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', weight, '中文龘'));
      const png = await renderCoverPng(svg(loaded.families['noto-sans-sc'], '中文龘', weight), loaded.fonts);
      const { data, info } = await pixels(png);
      expect(info.width).toBe(1600);
      expect(info.height).toBe(1600);
      expect(ink(data, info.width)).toBeGreaterThan(100);
      const glyphs = await Promise.all(
        [0, 1, 2].map(async (index) => {
          const glyph = await sharp(png)
            .extract({ left: 100 + 64 * index, top: 0, width: 64, height: 80 })
            .raw()
            .toBuffer();
          return glyph.toString('base64');
        }),
      );
      expect(new Set(glyphs).size).toBe(3);
      hashes.push(Buffer.from(png).toString('base64'));
    }
    expect(new Set(hashes).size).toBe(3);
    expect(free).toHaveBeenCalledTimes(3);
  });

  it.each(['png', 'jpeg'] as const)(
    'releases %s renderers after font and SVG failures, then renders again',
    async (format) => {
      const render = (document: string, fonts: Uint8Array[]) =>
        format === 'png' ? renderCoverPng(document, fonts) : renderCoverJpeg(document, fonts, 1200, 630);
      const free = vi.spyOn(Renderer.prototype, 'free');
      await expect(render(svg('sans-serif'), [new Uint8Array([1, 2, 3])])).rejects.toBeDefined();
      await expect(render('not an SVG', [])).rejects.toBeDefined();
      expect((await render(svg('sans-serif', ''), []))[0]).toBe(format === 'png' ? 137 : 255);
      expect(free).toHaveBeenCalledTimes(3);
    },
  );

  it.each(['png', 'jpeg'] as const)(
    'shares the concurrency guard while %s renders and releases it',
    async (format) => {
      const { env } = assets();
      const loaded = await loadCoverFonts(env, 'https://his.fm', slots('noto-sans-sc', 500, '中文'));
      const free = vi.spyOn(Renderer.prototype, 'free');
      const document = svg(loaded.families['noto-sans-sc'], '中文');
      const first =
        format === 'png'
          ? renderCoverPng(document, loaded.fonts)
          : renderCoverJpeg(document, loaded.fonts, 1200, 630);
      const second =
        format === 'png' ? renderCoverJpeg(document, [], 1200, 630) : renderCoverPng(document, []);
      const results = await Promise.allSettled([first, second]);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { status: 503 } });
      expect((await renderCoverJpeg(document, loaded.fonts, 1200, 630))[0]).toBe(255);
      expect(free).toHaveBeenCalledTimes(2);
    },
  );
});

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
  const { image, title = '中文龘', weight = 500, theme, share = false, frame, format = 'png', width = 1600, height = 1600 } = await request.json();
  const copy = { title, episodeNumber: 1, categoryName: '工作与睡眠' };
  const slots = share ? [] : theme ? coverText(theme, copy) : [{ font: 'noto-sans-sc', weight, value: title }];
  const { fonts, families } = await loadCoverFonts(env, 'https://his.fm', slots);
  const svg = share ? composeShareSvg(frame, image, width, height) : theme ? composeCoverSvg(theme, copy, image, frame, families) : '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="white"/><image href="' + image + '" width="80" height="80"/><text x="100" y="70" font-family="' + families['noto-sans-sc'] + '" font-weight="' + weight + '" font-size="64">' + title + '</text></svg>';
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

  it.each([
    'grove',
    'interval',
    'soft-landing',
    'human-sample',
    'stillwood',
    'tidal-hours',
    'window-seat',
    'alpine-bloom',
  ])(
    'renders the real %s composition with bounded wide Latin and Chinese titles',
    async (theme) => {
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
    },
    10_000,
  );

  it.each(['jpeg', 'png'] as const)(
    'bounds real-layout WASM memory with a high-entropy %s source',
    async (format) => {
      const size = format === 'jpeg' ? 2000 : 1100;
      const artwork = await sharp({
        create: {
          width: size,
          height: size,
          channels: 3,
          background: '#000000',
          noise: { type: 'gaussian', mean: 128, sigma: 64 },
        },
      })
        .toFormat(format)
        .toBuffer();
      expect(artwork.byteLength).toBeLessThan(4 * 1024 * 1024);
      const frame = readFileSync(
        new URL('../../public/brand/frames/soft-landing.svg', import.meta.url),
        'utf8',
      );
      const response = await mf.dispatchFetch('https://his.fm/cover-proof', {
        method: 'POST',
        body: JSON.stringify({
          image: `data:image/${format};base64,${artwork.toString('base64')}`,
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
    },
    10_000,
  );

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
        : { width, height };
      const artwork = await sharp(
        readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
      )
        .resize(crop.width, crop.height, { fit: 'cover' })
        .jpeg({ quality: 95 })
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
          frame,
          title: '从 WWDC 到 MWC：下班后，还要追多少个 AI？龘',
          image: `data:image/jpeg;base64,${artwork.toString('base64')}`,
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/jpeg');
      const bytes = new Uint8Array(await response.arrayBuffer());
      await expectJpeg(bytes, width, height);
      expect(bytes.byteLength).toBeGreaterThan(10_000);
      const wasmBytes = Number(response.headers.get('X-Wasm-Bytes'));
      console.info(
        `WASM JPEG ${width}x${height} ${theme ?? 'share'}: ${wasmBytes} bytes (${(wasmBytes / 1024 / 1024).toFixed(2)} MiB), source ${crop.width}x${crop.height} / ${artwork.byteLength} bytes`,
      );
      expect(wasmBytes).toBeGreaterThan(0);
      expect(wasmBytes).toBeLessThan(128 * 1024 * 1024);
    },
    20_000,
  );

  it.each(['stillwood', 'soft-landing'] as const)(
    'bounds a real 1600-square %s JPEG composition below 96 MiB in cold workerd',
    async (theme) => {
      const art = coverArtwork(theme);
      const crop = {
        width: Math.ceil((1600 * art.width) / coverDesignSize),
        height: Math.ceil((1600 * art.height) / coverDesignSize),
      };
      const artwork = await sharp(
        readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
      )
        .resize(crop.width, crop.height, { fit: 'cover' })
        .jpeg({ quality: 95 })
        .toBuffer();
      expect(await sharp(artwork).metadata()).toMatchObject(crop);
      const frame = readFileSync(new URL(`../../public/brand/frames/${theme}.svg`, import.meta.url), 'utf8');
      const worker = createWorker();
      try {
        const response = await worker.dispatchFetch('https://his.fm/cover-proof', {
          method: 'POST',
          body: JSON.stringify({
            format: 'jpeg',
            width: 1600,
            height: 1600,
            theme,
            frame,
            image: `data:image/jpeg;base64,${artwork.toString('base64')}`,
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
        console.info(
          `WASM cold JPEG 1600x1600 ${theme}: ${wasmBytes} bytes (${(wasmBytes / 1024 / 1024).toFixed(2)} MiB), source ${crop.width}x${crop.height} / ${artwork.byteLength} bytes`,
        );
        expect(wasmBytes).toBeGreaterThan(0);
        expect(wasmBytes).toBeLessThanOrEqual(96 * 1024 * 1024);
      } finally {
        await worker.dispose();
      }
    },
    20_000,
  );
});
