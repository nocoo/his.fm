import type { ThemeId } from './appearance';
import { coverLayouts } from './cover-composition';
import type { PublicEpisode } from './episode';

export type ArtRecord = {
  id: string;
  title: string;
  episodeNumber: number;
  coverUrl: string;
  categoryName: string;
  resource: 'episodes' | 'productions';
};

export async function withShareArtwork(episode: PublicEpisode, origin: string) {
  const url = `${origin}/episodes/${encodeURIComponent(episode.id)}/share.jpg`;
  if (episode.pageSeo.ogImageUrl !== url) return episode;
  const version = await artVersion({ ...episode, categoryName: '' }, null);
  return { ...episode, pageSeo: { ...episode.pageSeo, ogImageUrl: `${url}?v=${version}` } };
}

export async function artVersion(
  record: Pick<ArtRecord, 'coverUrl' | 'title' | 'episodeNumber' | 'categoryName'>,
  theme: ThemeId | null,
) {
  const inputs = theme
    ? [
        record.coverUrl,
        theme,
        record.title,
        record.episodeNumber,
        record.categoryName,
        coverLayouts[theme].frameDigest,
      ]
    : [record.coverUrl];
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(['jpeg-v1', ...inputs])),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function artLocation(record: ArtRecord, theme: ThemeId | null, size = 1400) {
  const version = await artVersion(record, theme);
  const kind = theme ? 'art' : 'share';
  const prefix = `rendered/${record.resource}/${encodeURIComponent(record.id)}/${kind}/${theme ?? 'stillwood'}/${version}/`;
  const query = new URLSearchParams({ v: version });
  if (theme && size !== 1400) query.set('size', String(size));
  return {
    prefix,
    key: `${prefix}${theme ? size : 1200}.jpg`,
    version,
    url: `/episodes/${encodeURIComponent(record.id)}/${kind}.jpg?${query}`,
  };
}
