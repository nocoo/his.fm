import type { PublicEpisode } from './episode';

/** Stable ordering for ambiguous legacy slug lookups (public API, redirects, client). */
export const legacyPublishedSlugOrderSql = 'published_at ASC, id ASC';

export function compareLegacyPublishedSlugCandidates(
  a: Pick<PublicEpisode, 'id' | 'publishedAt' | 'updatedAt'>,
  b: Pick<PublicEpisode, 'id' | 'publishedAt' | 'updatedAt'>,
) {
  const left = a.publishedAt ?? a.updatedAt;
  const right = b.publishedAt ?? b.updatedAt;
  if (left !== right) return left.localeCompare(right);
  return a.id.localeCompare(b.id);
}

export function pickLegacyPublishedEpisode<
  T extends Pick<PublicEpisode, 'id' | 'slug' | 'publishedAt' | 'updatedAt'>,
>(episodes: T[], slug: string): T | undefined {
  const matches = episodes.filter((episode) => episode.slug === slug);
  if (!matches.length) return undefined;
  return [...matches].sort(compareLegacyPublishedSlugCandidates)[0];
}
