import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { themeCoverFrameSrc } from '../brand/themes';
import { FramedCover } from '../components/FramedCover';
import { themeIds } from './appearance';
import {
  composeCoverSvg,
  coverArtwork,
  coverDesignSize,
  coverLayouts,
  coverSize,
  coverText,
  escapeCoverXml,
  splitCoverTitle,
} from './cover-composition';

const copy = { title: '下班后，还要追多少个 AI？', episodeNumber: 1, categoryName: '主理人手札' };

describe('cover typography', () => {
  it('keeps the approved two-line title, balances punctuation and preserves Latin words', () => {
    expect(splitCoverTitle(copy.title)).toEqual(['下班后，还要', '追多少个 AI？']);
    expect(splitCoverTitle('  慢慢来\n  ')).toEqual(['慢慢来', '']);
    expect(splitCoverTitle('')).toEqual(['', '']);
    expect(splitCoverTitle('Life outside the browser')).toEqual(['Life outside', 'the browser']);
    expect(splitCoverTitle('iiiiiiiiiiiiiiiiiiiiiiiiiiiiii').join('')).toBe('iiiiiiiiiiiiiiiiiiiiiiiiiiiiii');
    expect(splitCoverTitle('晚饭以后，先去散步').join('')).toBe('晚饭以后，先去散步');
  });

  it.each(themeIds)('%s shares the canonical title baselines and metadata', (theme) => {
    const slots = coverText(theme, copy);
    const titles = slots.filter((slot) => slot.template.startsWith('{title'));
    expect(titles.map((slot) => slot.value)).toEqual(['下班后，还要', '追多少个 AI？']);
    expect(titles.map((slot) => slot.y)).toEqual(
      coverLayouts[theme].text.filter((slot) => slot.template.startsWith('{title')).map((slot) => slot.y),
    );
    expect(slots.some((slot) => slot.value.includes('001'))).toBe(true);
    expect(slots.some((slot) => slot.value.includes(copy.categoryName))).toBe(true);
    for (const slot of slots) {
      expect(slot.fontSize).toBeLessThanOrEqual(slot.size);
      expect(slot.fontSize).toBeGreaterThanOrEqual(slot.size * 0.65);
      expect(slot.fontFamily).toBeTruthy();
    }
  });

  it.each(themeIds)('%s centers short titles, bounds long copy and omits absent metadata', (theme) => {
    const [first, second] = coverLayouts[theme].text.filter((slot) => slot.template.startsWith('{title'));
    const short = coverText(theme, { title: '晚风' });
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({ template: '{title1}', value: '晚风', y: (first.y + second.y) / 2 });
    const long = coverText(theme, { title: '很长的标题'.repeat(30), categoryName: '分类'.repeat(40) });
    for (const slot of long) {
      expect(slot.value).toMatch(/…$/u);
      expect(slot.fontSize).toBeGreaterThanOrEqual(slot.size * 0.65);
      expect(slot.fontSize).toBeLessThanOrEqual(slot.size);
    }
    expect(coverText(theme, { title: '' })).toEqual([]);
    for (const episodeNumber of [0, -1, 1.5, Number.NaN])
      expect(coverText(theme, { title: '', episodeNumber, categoryName: ' ' })).toEqual([]);
  });

  it('does not invent an episode number or leave a dangling category separator', () => {
    const category = coverText('soft-landing', { title: '', categoryName: '  生活  ' });
    expect(category).toHaveLength(1);
    expect(category[0].value).toBe('生活');
    expect(coverText('soft-landing', { title: '', episodeNumber: 1234 })[0].value).toBe('EP.1234');
  });

  it('aligns the Interval number with the fixed footer row and leaves room below its smaller title', () => {
    const slots = coverText('interval', copy);
    expect(slots.find((slot) => slot.template === '{number}')).toMatchObject({ y: 1000 });
    const titles = slots.filter((slot) => slot.template.startsWith('{title'));
    expect(titles.map((slot) => ({ y: slot.y, fontSize: slot.fontSize }))).toEqual([
      { y: 872, fontSize: 58 },
      { y: 944, fontSize: 58 },
    ]);
  });

  it.each(themeIds)('%s reserves the action area and fits wide Latin titles', (theme) => {
    const titles = coverText(theme, {
      title: '从 WWDC 到 MWC：我们为什么总在期待下一个改变世界的产品',
    });
    expect(titles.map((slot) => slot.value).join('')).toContain('WWDC');
    for (const slot of titles) {
      expect(slot.x + slot.maxWidth).toBeLessThanOrEqual(842);
      expect(slot.fontSize).toBeLessThanOrEqual(slot.size);
    }
    const wide = coverText(theme, { title: 'W'.repeat(32) });
    const narrow = coverText(theme, { title: 'i'.repeat(32) });
    expect(wide[0].fontSize).toBeLessThan(narrow[0].fontSize);
  });
});

describe('shared preview and PNG composition', () => {
  it('keeps the Tidal outer hairline inside the shared frame without changing the artwork window', () => {
    const frame = readFileSync(
      new URL(`../../public${themeCoverFrameSrc('tidal-hours')}`, import.meta.url),
      'utf8',
    );
    const border =
      '<rect x="1" y="1" width="1022" height="1022" fill="none" stroke="#344C57" stroke-width="2" stroke-opacity=".45"/>';
    expect(frame).toContain(border);
    expect(composeCoverSvg('tidal-hours', copy, 'data:image/webp;base64,AAAA', frame)).toContain(border);
    expect(coverLayouts['tidal-hours'].artwork).toEqual({ x: 36, y: 190, width: 952, height: 540 });
  });

  it.each(themeIds)('%s uses the same art window, title, font and full static frame', (theme) => {
    const frame = readFileSync(new URL(`../../public${themeCoverFrameSrc(theme)}`, import.meta.url), 'utf8');
    const svg = composeCoverSvg(theme, copy, 'data:image/webp;base64,AAAA', frame);
    const preview = renderToStaticMarkup(
      createElement(FramedCover, { ...copy, src: '/images/clean.webp', themeId: theme }),
    );
    expect(coverSize).toBe(1600);
    expect(coverDesignSize).toBe(1024);
    expect(svg).toContain('width="1600" height="1600" viewBox="0 0 1024 1024"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(svg).not.toMatch(/\{title|\{number|\{category/);
    expect(frame).not.toContain('<text');
    expect(frame).toContain('<path');
    const art = coverArtwork(theme);
    const window = coverLayouts[theme].artwork;
    const bleed = window.width === coverDesignSize ? 0 : 2;
    expect(art).toEqual({
      x: window.x - bleed,
      y: window.y - bleed,
      width: window.width + bleed * 2,
      height: window.height + bleed * 2,
    });
    expect(art.x + art.width / 2).toBe(window.x + window.width / 2);
    expect(art.y + art.height / 2).toBe(window.y + window.height / 2);
    expect(svg).toContain(`<svg x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}"`);
    expect(preview).toContain(`left:${(art.x / coverDesignSize) * 100}%`);
    expect(preview).toContain(`top:${(art.y / coverDesignSize) * 100}%`);
    expect(preview).toContain(`width:${(art.width / coverDesignSize) * 100}%`);
    expect(preview).toContain(`height:${(art.height / coverDesignSize) * 100}%`);
    expect(preview).toContain(`src="${themeCoverFrameSrc(theme)}"`);
    expect(preview).toContain('src="/images/clean.webp"');
    for (const slot of coverText(theme, copy)) {
      const text = `<text x="${slot.x}" y="${slot.y}" fill="${slot.fill}"`;
      expect(svg).toContain(text);
      expect(preview).toContain(text);
      expect(svg).toContain(`>${escapeCoverXml(slot.value)}</text>`);
      expect(preview).toContain(`>${escapeCoverXml(slot.value)}</text>`);
    }
  });

  it('escapes dynamic XML and uses selected static font aliases without external URLs', () => {
    expect(escapeCoverXml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&apos;');
    const svg = composeCoverSvg(
      'stillwood',
      { title: '<script>&', categoryName: 'A & B' },
      'data:image/png;base64,a"b',
      '<svg viewBox="0 0 1024 1024"><path d="M0 0"/></svg>\n',
      { 'noto-sans-sc': 'Sans Shard 1, Sans Shard 2', 'noto-serif-sc': 'Serif Shard 3' },
    );
    expect(svg).toContain('font-family="Serif Shard 3"');
    expect(svg).toContain('font-family="Sans Shard 1, Sans Shard 2"');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('A &amp; B');
    expect(svg).toContain('href="data:image/png;base64,a&quot;b"');
    expect(svg).toContain('<path d="M0 0"/>');
    expect(svg).not.toMatch(/href="https?:\/\//u);
  });
});
