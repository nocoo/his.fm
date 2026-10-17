import layouts from '../brand/cover-frame-layouts.json' with { type: 'json' };
import type { ThemeId } from './appearance';

export const coverSize = layouts.size;
export const coverDesignSize = layouts.designSize;
export const coverLayouts = layouts.themes;
export const coverFontFamilies: Record<string, string> = {
  'noto-sans-sc': 'Noto Sans SC',
  'noto-serif-sc': 'Noto Serif SC',
  'space-grotesk': 'Space Grotesk',
};
const fontWidths: Record<string, number[]> = layouts.fontWidths;

export type CoverCopy = {
  title: string;
  episodeNumber?: number;
  categoryName?: string;
};

export function coverArtwork(theme: ThemeId) {
  const art = coverLayouts[theme].artwork;
  // Bleed under the frame so independently antialiased edges cannot expose the page.
  const bleed = art.width === coverDesignSize && art.height === coverDesignSize ? 0 : 2;
  return {
    x: art.x - bleed,
    y: art.y - bleed,
    width: art.width + bleed * 2,
    height: art.height + bleed * 2,
  };
}

function textWidth(value: string, font = 'noto-sans-sc:500'): number {
  return Array.from(value).reduce(
    (sum, character) => sum + (fontWidths[font][character.charCodeAt(0) - 32] ?? 1),
    0,
  );
}

export function splitCoverTitle(title: string): [string, string] {
  const value = title.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(value);
  const width = textWidth(value);
  if (width <= 8) return [value, ''];
  let split = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < characters.length; index++) {
    const left = characters.slice(0, index).join('');
    const proportion = textWidth(left) / width;
    if (proportion < 0.3 || proportion > 0.7) continue;
    const boundary = /[，。？！；：、,!?;:\s—–-]$/u.test(left);
    const wordBreak = /[a-z0-9]$/i.test(left) && /^[a-z0-9]/i.test(characters[index]);
    const score = Math.abs(proportion - 0.5) + (boundary ? -0.14 : 0) + (wordBreak ? 0.5 : 0);
    if (score < best) {
      best = score;
      split = index;
    }
  }
  return [characters.slice(0, split).join('').trim(), characters.slice(split).join('').trim()];
}

export function coverText(theme: ThemeId, copy: CoverCopy) {
  const [title1, title2] = splitCoverTitle(copy.title);
  const number =
    Number.isInteger(copy.episodeNumber) && (copy.episodeNumber ?? 0) > 0
      ? String(copy.episodeNumber).padStart(3, '0')
      : '';
  const category = copy.categoryName?.trim() ?? '';
  const titleSlots = coverLayouts[theme].text.filter((slot) => slot.template.startsWith('{title'));
  return coverLayouts[theme].text.flatMap((slot) => {
    if (slot.template.includes('{number}') && !number && !slot.template.includes('{category}')) return [];
    let value = slot.template
      .replace('{number}', number)
      .replace('{category}', category)
      .replace('{title1}', title1)
      .replace('{title2}', title2);
    if (slot.template.includes('{category}')) {
      if (!number && slot.template.includes('{number}')) value = category;
      else if (!category) value = value.replace(/\s*\/\s*$/, '');
    }
    if (!value) return [];
    const font = `${slot.font}:${slot.weight}`;
    const availableWidth = () => slot.maxWidth - Math.max(0, Array.from(value).length - 1) * slot.tracking;
    const minimumSize = slot.size * 0.65;
    while (value.length > 1 && textWidth(value, font) * minimumSize > availableWidth()) {
      value = `${Array.from(value.replace(/…$/u, '')).slice(0, -1).join('')}…`;
    }
    const fontSize = Math.min(slot.size, availableWidth() / textWidth(value, font));
    const y = slot.template === '{title1}' && !title2 ? (titleSlots[0].y + titleSlots[1].y) / 2 : slot.y;
    return [{ ...slot, y, value, fontSize, fontFamily: coverFontFamilies[slot.font] }];
  });
}

export function escapeCoverXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character];
  });
}

export function composeCoverSvg(
  theme: ThemeId,
  copy: CoverCopy,
  artworkDataUrl: string,
  frameSvg: string,
  fontFamilies: Record<string, string> = coverFontFamilies,
): string {
  const layout = coverLayouts[theme];
  const art = coverArtwork(theme);
  const text = coverText(theme, copy)
    .map(
      (slot) =>
        `<text x="${slot.x}" y="${slot.y}" fill="${slot.fill}" font-family="${escapeCoverXml(fontFamilies[slot.font])}" font-size="${slot.fontSize}" font-weight="${slot.weight}" letter-spacing="${slot.tracking}">${escapeCoverXml(slot.value)}</text>`,
    )
    .join('');
  const frame = frameSvg.replace(/<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${coverSize}" height="${coverSize}" viewBox="0 0 ${coverDesignSize} ${coverDesignSize}"><rect width="1024" height="1024" fill="${layout.paper}"/><svg x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}" overflow="hidden"><image width="${art.width}" height="${art.height}" preserveAspectRatio="xMidYMid slice" href="${escapeCoverXml(artworkDataUrl)}"/></svg>${frame}${text}</svg>`;
}
