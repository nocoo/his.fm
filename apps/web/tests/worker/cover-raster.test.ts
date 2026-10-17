import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Renderer } from '@takumi-rs/wasm';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { rolldown } from 'rolldown';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import manifest from '../../public/brand/fonts/cover/manifest.json';
import { coverText } from '../../src/shared/cover-composition';
import { loadCoverFonts } from '../../worker/cover-fonts';
import { renderCoverPng } from '../../worker/cover-raster';

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

  it('releases renderers after font and SVG failures, then renders again', async () => {
    const free = vi.spyOn(Renderer.prototype, 'free');
    await expect(renderCoverPng(svg('sans-serif'), [new Uint8Array([1, 2, 3])])).rejects.toBeDefined();
    await expect(renderCoverPng('not an SVG', [])).rejects.toBeDefined();
    expect((await renderCoverPng(svg('sans-serif', ''), []))[0]).toBe(137);
    expect(free).toHaveBeenCalledTimes(3);
  });
});

describe('deployed-like workerd WASM', { concurrent: false }, () => {
  let mf: Miniflare;

  beforeAll(async () => {
    const raster = fileURLToPath(new URL('../../worker/cover-raster.ts', import.meta.url));
    const loader = fileURLToPath(new URL('../../worker/cover-fonts.ts', import.meta.url));
    const composition = fileURLToPath(new URL('../../src/shared/cover-composition.ts', import.meta.url));
    const source = `import { renderCoverPng } from ${JSON.stringify(raster)};
import { loadCoverFonts } from ${JSON.stringify(loader)};
import { coverText, composeCoverSvg } from ${JSON.stringify(composition)};
import { initSync } from '@takumi-rs/wasm';
import wasm from '@takumi-rs/wasm/takumi_wasm_bg.wasm';
globalThis.fetch = () => { throw new Error('Unexpected outbound fetch'); };
export default { async fetch(request, env) {
  const { image, title = '中文龘', weight = 500, theme, frame } = await request.json();
  const copy = { title, episodeNumber: 1, categoryName: '工作与睡眠' };
  const slots = theme ? coverText(theme, copy) : [{ font: 'noto-sans-sc', weight, value: title }];
  const { fonts, families } = await loadCoverFonts(env, 'https://his.fm', slots);
  const svg = theme ? composeCoverSvg(theme, copy, image, frame, families) : '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="white"/><image href="' + image + '" width="80" height="80"/><text x="100" y="70" font-family="' + families['noto-sans-sc'] + '" font-weight="' + weight + '" font-size="64">' + title + '</text></svg>';
  const png = await renderCoverPng(svg, fonts);
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'X-Wasm-Bytes': String(initSync({module:wasm}).memory.buffer.byteLength) } });
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
    mf = new Miniflare({
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
  }, 20_000);

  afterAll(async () => mf?.dispose());

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
      const { data } = await pixels(png);
      const { data: background } = await pixels(new Uint8Array(await blank.arrayBuffer()));
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
});
