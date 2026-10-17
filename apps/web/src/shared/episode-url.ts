import type { Episode } from './episode';

export function episodePublicPath(categoryId: string, slug: string) {
  return `/episodes/${categoryId}/${slug}`;
}

export function episodeCanonicalUrl(origin: string, episode: Pick<Episode, 'category' | 'slug'>) {
  return `${origin}${episodePublicPath(episode.category, episode.slug)}`;
}

export function categoryPublicPath(categoryId: string) {
  return `/episodes?category=${encodeURIComponent(categoryId)}`;
}

export function isReservedEpisodeSegment(segment: string) {
  return segment === 'episodes' || segment === 'about' || segment === 'login';
}
