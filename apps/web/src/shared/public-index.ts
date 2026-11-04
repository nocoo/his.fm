import type { PublicCategory } from './category';
import type { Episode } from './episode';
import type { SeoOverride, SiteSeo } from './seo';

export function isPublishedEpisodeRecord(episode: Episode, now = new Date()): boolean {
  if (episode.status !== 'published') return false;
  if (!episode.publishedAt) return false;
  return new Date(episode.publishedAt).getTime() <= now.getTime();
}

export function isEpisodeSeoIndexable(seo: SeoOverride | undefined): boolean {
  return !(seo?.noindex ?? false);
}

export function isPublicEpisodeIndexable(episode: Episode, _origin: string, _site: SiteSeo): boolean {
  if (!isPublishedEpisodeRecord(episode)) return false;
  return isEpisodeSeoIndexable(episode.seo);
}

export function filterIndexableEpisodes(episodes: Episode[], origin: string, site: SiteSeo): Episode[] {
  return episodes.filter((episode) => isPublicEpisodeIndexable(episode, origin, site));
}

export function categoriesWithIndexableEpisodes(
  categories: PublicCategory[],
  episodes: Array<{ category: string }>,
): PublicCategory[] {
  return categories.filter((category) => episodes.some((episode) => episode.category === category.id));
}
