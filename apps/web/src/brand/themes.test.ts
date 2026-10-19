import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { themeIds } from '../shared/appearance';
import { themeCoverFrameSrc, themeFaviconSrc, themes } from './themes';

describe('theme cover frames', () => {
  it('maps every theme to its design-system overlay SVG', () => {
    for (const id of themeIds) {
      expect(themeCoverFrameSrc(id)).toBe(`/brand/frames/${id}.svg`);
    }
  });
});

describe('canonical theme favicons', () => {
  it('exports every theme with its primary background and the unchanged white identity symbol', () => {
    const directory = new URL('../../public/brand/favicons/', import.meta.url);
    const identity = readFileSync(new URL('./identity.svg', import.meta.url), 'utf8');
    const symbol = identity.match(/<symbol id="symbol"[^>]*>(.*?)<\/symbol>/s)?.[1];
    expect(symbol).toBeTruthy();
    expect(readdirSync(directory).sort()).toEqual(themeIds.map((id) => `${id}.svg`).sort());
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
});
