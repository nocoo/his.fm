import { readFileSync } from 'node:fs';
import { Renderer } from '@takumi-rs/wasm';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../public/brand/fonts/cover/manifest.json';
import { coverText } from '../../src/shared/cover-composition';
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
