import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { themeIds } from '../shared/appearance';
import { coverLayouts } from '../shared/cover-composition';
import { themeChromeColor, themeCoverFrameSrc, themeFaviconPngSrc, themeFaviconSrc, themes } from './themes';

it('matches browser chrome to dark home headers, paper inner pages and the preview banner', () => {
  for (const id of themeIds) {
    const [paper, ink] = themes[id].palette;
    expect(themeChromeColor(id, '/')).toBe(id === 'stillwood' || id === 'window-seat' ? ink : paper);
    expect(themeChromeColor(id, '/episodes')).toBe(paper);
    expect(themeChromeColor(id, '/about')).toBe(paper);
    expect(themeChromeColor(id, '/', true)).toBe(ink);
    expect(themeChromeColor(id, '/episodes', true)).toBe(ink);
  }
});

it('keeps theme names, design copy and palette labels from the archived design index', () => {
  const index = readFileSync(new URL('../../../../docs/design/index.html', import.meta.url), 'utf8');
  for (const theme of Object.values(themes)) {
    for (const text of [theme.name, theme.english, theme.designStyle, theme.designSlogan, theme.description])
      expect(index).toContain(text);
    for (const [position, color] of theme.palette.entries())
      expect(index).toContain(`${theme.paletteNames[position]} ${color}`);
  }
});

describe('theme cover frames', () => {
  it('maps every theme to its design-system overlay SVG', () => {
    for (const id of themeIds) {
      expect(themeCoverFrameSrc(id)).toBe(`/brand/frames/${id}.svg`);
    }
  });

  it('versions finished artwork with the exact exported frame bytes', () => {
    for (const id of themeIds) {
      const frame = readFileSync(new URL(`../../public/brand/frames/${id}.svg`, import.meta.url));
      expect(coverLayouts[id].frameDigest).toBe(createHash('sha256').update(frame).digest('hex'));
    }
  });

  it.each([
    ['stillwood', 59, 46, 319, '#ffffff'],
    ['alpine-bloom', 54, 41, 334, '#404F50'],
  ] as const)(
    'uses the canonical left-aligned lockup in %s without changing the identity',
    (id, x, y, width, color) => {
      const identity = readFileSync(new URL('./identity.svg', import.meta.url), 'utf8');
      const wordmark = identity.match(/<symbol id="wordmark"[^>]*>(.*?)<\/symbol>/s)?.[1];
      const symbol = identity.match(/<symbol id="symbol"[^>]*>(.*?)<\/symbol>/s)?.[1];
      expect(wordmark).toBeTruthy();
      expect(symbol).toBeTruthy();
      const frame = readFileSync(new URL(`../../public/brand/frames/${id}.svg`, import.meta.url), 'utf8');
      const scale = width / 600;
      expect(frame).toContain(
        `<g data-cover-lockup="canonical" color="${color}" transform="translate(${x - 25.04 * scale} ${y}) scale(${scale})">${wordmark}<g transform="translate(${600 + (600 * 8) / 116} 0) scale(${170 / 128})">${symbol}</g></g>`,
      );
      expect(frame).not.toContain('<text');
    },
  );
});

describe('canonical theme favicons', () => {
  it('exports every theme with its primary background and the unchanged white identity symbol', () => {
    const directory = new URL('../../public/brand/favicons/', import.meta.url);
    const identity = readFileSync(new URL('./identity.svg', import.meta.url), 'utf8');
    const symbol = identity.match(/<symbol id="symbol"[^>]*>(.*?)<\/symbol>/s)?.[1];
    expect(symbol).toBeTruthy();
    expect(
      readdirSync(directory)
        .filter((name) => name.endsWith('.svg'))
        .sort(),
    ).toEqual(themeIds.map((id) => `${id}.svg`).sort());
    for (const id of themeIds) {
      expect(themeFaviconSrc(id)).toBe(`/brand/favicons/${id}.svg`);
      const svg = readFileSync(new URL(`${id}.svg`, directory), 'utf8');
      expect(svg).toContain('viewBox="0 0 128 128" color="#ffffff"');
      expect(svg).toContain(
        `<rect width="128" height="128" rx="20" fill="${themes[id].palette[1].toLowerCase()}"/>`,
      );
      expect(svg).toContain(`<g transform="translate(16 16) scale(0.75)">${symbol}</g>`);
      expect(svg).not.toContain('<text');
    }
  });

  it('ships a 32-square bitmap fallback for each theme', () => {
    const directory = new URL('../../public/brand/favicons/', import.meta.url);
    for (const id of themeIds) {
      expect(themeFaviconPngSrc(id)).toBe(`/brand/favicons/${id}-32.png`);
      const bytes = readFileSync(new URL(`${id}-32.png`, directory));
      expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([32, 32]);
    }
  });
});
