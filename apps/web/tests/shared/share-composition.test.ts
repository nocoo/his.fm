import { readFileSync } from 'node:fs';
import { Renderer } from '@takumi-rs/wasm/node';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { composeShareSvg, shareArtworkFocusY } from '../../src/shared/share-composition';

const wordmark = readFileSync(new URL('../../../../docs/design/assets/05/logo.svg', import.meta.url), 'utf8');

describe('share artwork composition', () => {
  it('anchors the crop window on the upper-middle subject, not the crop remainder', () => {
    expect(shareArtworkFocusY).toBe(0.4);
  });

  it('uses the archived outlined identity, a thin inset border and seeded flax paper', () => {
    const svg = composeShareSvg(wordmark);
    expect(svg).toContain('width="1200" height="630" viewBox="0 0 1200 630"');
    expect(svg).toContain('fill="#ECEBE1" filter="url(#flax-paper)"');
    expect(svg).toContain('seed="5"');
    expect(svg).toContain('x="31.5" y="31.5" width="1137" height="567" fill="none"');
    expect(svg).toContain('stroke="#263C35" stroke-opacity=".6"');
    expect(svg).toContain('<svg x="63" y="63"');
    expect(svg).toContain(wordmark.match(/<path[^>]+\/>/)?.[0]);
    expect(svg).not.toMatch(/<text|<image|<linearGradient|<title/);
    expect(composeShareSvg(wordmark)).toBe(svg);
  });

  it('scales the same identity and safe area to square podcast artwork', () => {
    const svg = composeShareSvg(wordmark, undefined, 3000, 3000);
    expect(svg).toContain('width="3000" height="3000" viewBox="0 0 3000 3000"');
    expect(svg).toContain('x="150" y="150" width="2700" height="2700"');
    expect(svg).toContain('<svg x="300" y="300" width="1260"');
  });

  it('cover-crops original artwork with only a light wordmark and border above it', () => {
    const svg = composeShareSvg(wordmark, {
      dataUrl: 'data:image/png;base64,AAAA',
      width: 1400,
      height: 1400,
    });
    expect(svg).toContain(
      '<image x="0" y="-165" width="1200" height="1200" href="data:image/png;base64,AAAA"/>',
    );
    expect(svg).toContain('fill="#ECEBE1" transform="matrix(');
    expect(svg).toContain('stroke="#ECEBE1" stroke-opacity=".6"');
    expect(svg).toContain('stroke="#263C35" stroke-width="6"');
    expect(svg.match(/<rect\b/g)).toHaveLength(1);
    expect(svg).not.toMatch(/<text|<filter|<defs|Gradient|flax-paper|<title/);
  });

  it('escapes artwork attributes without dependencies on browser-only composition modules', () => {
    const svg = composeShareSvg(wordmark, {
      dataUrl: 'data:image/svg+xml,<svg a="b">&\'</svg>',
      width: 1200,
      height: 630,
    });
    expect(svg).toContain('href="data:image/svg+xml,&lt;svg a=&quot;b&quot;&gt;&amp;&apos;&lt;/svg&gt;"');
    expect(svg).not.toContain('<svg a=');
  });

  it('renders the upper-middle subject edge-to-edge without a bottom shade', async () => {
    const original = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#668844' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 120, height: 30, channels: 3, background: '#ff0000' },
          })
            .png()
            .toBuffer(),
          top: 0,
          left: 0,
        },
        {
          input: await sharp({
            create: { width: 120, height: 30, channels: 3, background: '#0000ff' },
          })
            .png()
            .toBuffer(),
          top: 90,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const svg = composeShareSvg(wordmark, {
      dataUrl: `data:image/png;base64,${original.toString('base64')}`,
      width: 120,
      height: 120,
    });
    const renderer = new Renderer();
    try {
      const png = await renderer.render(
        { type: 'image', src: 'share.svg', style: { width: 1200, height: 630 } },
        {
          width: 1200,
          height: 630,
          format: 'png',
          images: [{ src: 'share.svg', data: new TextEncoder().encode(svg), cache: 'none' }],
        },
      );
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => [
        ...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
      ];
      expect(pixel(600, 2)).toEqual([255, 0, 0]);
      expect(pixel(600, 627)).toEqual([102, 136, 68]);
      for (const [x, y] of [
        [2, 315],
        [1197, 315],
        [600, 315],
        [600, 550],
      ]) {
        expect(pixel(x, y)).toEqual([102, 136, 68]);
      }
    } finally {
      renderer.free();
    }
  });

  it.each([
    [0, 630],
    [1200, -1],
    [1.5, 630],
    [1200, Number.NaN],
    [Number.POSITIVE_INFINITY, 630],
    [Number.MAX_SAFE_INTEGER + 1, 630],
  ])('rejects invalid dimensions %s x %s', (width, height) => {
    expect(() => composeShareSvg(wordmark, undefined, width, height)).toThrow(RangeError);
  });
});
