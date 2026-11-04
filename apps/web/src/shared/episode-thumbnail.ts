import type { ThemeId } from './appearance';
import type { PublicEpisode } from './episode';

export const episodeThumbnailWidths = [160, 240, 320, 480, 640, 960] as const;

/** Caps slot width in `sizes` so ~1.75–2× DPR picks 480w/320w, not 640w, on phone grids. */
const gridCaps = {
  singleColumn: 240,
  twoColumn: 170,
  threeColumnNarrow: 200,
  threeColumnWide: 240,
} as const;

const listCaps = { narrow: 160, wide: 260 } as const;

const detailCaps = { narrow: 274, rail: 490 } as const;

export function episodeThumbnailKey(
  source: string,
  origin = 'https://his.fm',
  mediaBase = 'https://f.no.mt',
): string | null {
  let url: URL;
  let base: URL;
  try {
    url = new URL(source, origin);
    base = new URL(`${mediaBase.replace(/\/$/, '')}/`, origin);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const path =
    url.origin === origin && url.pathname.startsWith('/media/')
      ? url.pathname.slice('/media/'.length)
      : url.origin === base.origin && url.pathname.startsWith(base.pathname)
        ? url.pathname.slice(base.pathname.length)
        : '';
  let key: string;
  try {
    key = decodeURIComponent(path);
  } catch {
    return null;
  }
  return key &&
    !/[\\\p{Cc}]/u.test(key) &&
    !key.split('/').some((part) => !part || part === '.' || part === '..')
    ? key
    : null;
}

export function episodeThumbnailProps(
  episode: Pick<PublicEpisode, 'id' | 'version' | 'coverUrl'>,
  theme: ThemeId,
) {
  if (
    !episodeThumbnailKey(episode.coverUrl) ||
    /^https:\/\/f\.no\.mt\/images\/episode-0[1-3]\.webp$/.test(episode.coverUrl)
  ) {
    return { src: episode.coverUrl };
  }
  const path = `/media/episode-thumbnails/${encodeURIComponent(episode.id)}/${episode.version}/${theme}`;
  return {
    src: `${path}/320.webp`,
    srcSet: episodeThumbnailWidths.map((width) => `${path}/${width}.webp ${width}w`).join(', '),
  };
}

function cappedSlot(expression: string, capPx: number, artworkScale: number): string {
  return `calc(min(${expression}, ${capPx}px) * ${artworkScale})`;
}

export function episodeThumbnailSizes(artworkScale: number, detail = false, list = false): string {
  if (detail) {
    return [
      `(max-width: 538px) ${cappedSlot('(100vw - 48px)', detailCaps.narrow, artworkScale)}`,
      `(max-width: 760px) ${cappedSlot(`${detailCaps.rail}px`, detailCaps.rail, artworkScale)}`,
      cappedSlot('min(90.8vw, 1424px) * 0.4185', 640, artworkScale),
    ].join(', ');
  }
  if (list) {
    return [
      `(max-width: 760px) ${cappedSlot(`${listCaps.narrow}px`, listCaps.narrow, artworkScale)}`,
      cappedSlot(`${listCaps.wide}px`, listCaps.wide, artworkScale),
    ].join(', ');
  }
  return [
    `(max-width: 480px) ${cappedSlot('(100vw - 48px)', gridCaps.singleColumn, artworkScale)}`,
    `(max-width: 760px) ${cappedSlot('((100vw - 68px) / 2)', gridCaps.twoColumn, artworkScale)}`,
    `(max-width: 1100px) ${cappedSlot('((90.8vw - 48px) / 3)', gridCaps.threeColumnNarrow, artworkScale)}`,
    cappedSlot('((min(90.8vw, 1424px) - 64px) / 3)', gridCaps.threeColumnWide, artworkScale),
  ].join(', ');
}
