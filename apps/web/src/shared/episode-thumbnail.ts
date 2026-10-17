import type { ThemeId } from './appearance';
import type { PublicEpisode } from './episode';

export const episodeThumbnailWidths = [160, 240, 320, 480, 640, 960] as const;

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
    src: `${path}/480.webp`,
    srcSet: episodeThumbnailWidths.map((width) => `${path}/${width}.webp ${width}w`).join(', '),
  };
}

export function episodeThumbnailSizes(artworkScale: number, detail = false, list = false): string {
  const size = (expression: string) => `calc((${expression}) * ${artworkScale})`;
  if (detail) {
    return `(max-width: 538px) ${size('100vw - 48px')}, (max-width: 760px) ${size('490px')}, ${size('min(90.8vw, 1424px) * 0.4185')}`;
  }
  if (list) return `auto, (max-width: 760px) ${size('160px')}, ${size('260px')}`;
  return `auto, (max-width: 480px) ${size('100vw - 48px')}, (max-width: 760px) ${size('(100vw - 68px) / 2')}, (max-width: 1100px) ${size('(90.8vw - 48px) / 3')}, ${size('(min(90.8vw, 1424px) - 64px) / 3')}`;
}
