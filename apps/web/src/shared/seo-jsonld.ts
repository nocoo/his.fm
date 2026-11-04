import type { PublicCategory } from './category';
import { iso8601Duration } from './duration-iso8601';
import type { PublicEpisode } from './episode';
import { episodeCanonicalUrl, episodePublicPath } from './episode-url';
import { podcastEpisodeMentionsJsonLd } from './mentions-format';
import { APPLE_PODCASTS_URL } from './public-cache-policy';
import { programmeColumnDescription } from './public-copy';
import type { SiteSeo } from './seo';

export function podcastAuthorJsonLd(site: SiteSeo) {
  return {
    '@type': site.podcastAuthorType,
    name: site.podcastAuthor,
    ...(site.podcastAuthorUrl ? { url: site.podcastAuthorUrl } : {}),
  };
}

export function podcastSeriesJsonLd(origin: string, site: SiteSeo, categories: PublicCategory[] = []) {
  const description = categories.length ? programmeColumnDescription(categories) : site.podcastDescription;
  const image = site.defaultOgImageUrl.startsWith('http')
    ? site.defaultOgImageUrl
    : `${origin}${site.defaultOgImageUrl.startsWith('/') ? site.defaultOgImageUrl : `/${site.defaultOgImageUrl}`}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: site.siteName,
    description,
    url: `${origin}/`,
    image,
    webFeed: `${origin}/feed.xml`,
    sameAs: [APPLE_PODCASTS_URL],
    inLanguage: site.language,
    author: podcastAuthorJsonLd(site),
  };
}

export function podcastEpisodeJsonLd(
  origin: string,
  episode: PublicEpisode,
  site: SiteSeo,
  audioAbsoluteUrl?: string | null,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: episode.title,
    description: episode.summary,
    url: episodeCanonicalUrl(origin, episode),
    episodeNumber: episode.episodeNumber,
    image: `${origin}/episodes/${encodeURIComponent(episode.id)}/art.jpg`,
    datePublished: episode.publishedAt ?? episode.updatedAt,
    author: podcastAuthorJsonLd(site),
    ...(audioAbsoluteUrl
      ? {
          associatedMedia: {
            '@type': 'MediaObject',
            contentUrl: audioAbsoluteUrl,
            encodingFormat: 'audio/mpeg',
            ...(iso8601Duration(episode.durationSeconds)
              ? { duration: iso8601Duration(episode.durationSeconds) }
              : {}),
          },
          ...(iso8601Duration(episode.durationSeconds)
            ? { timeRequired: iso8601Duration(episode.durationSeconds) }
            : {}),
        }
      : {}),
    ...(episode.mentions.length ? { mentions: podcastEpisodeMentionsJsonLd(episode.mentions) } : {}),
    partOfSeries: { '@type': 'PodcastSeries', name: 'his.fm', url: `${origin}/` },
  };
}

export function breadcrumbJsonLd(origin: string, items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${origin}${item.path}`,
    })),
  };
}

export function episodeBreadcrumbs(origin: string, category: PublicCategory, episode: PublicEpisode) {
  return breadcrumbJsonLd(origin, [
    { name: '首页', path: '/' },
    { name: '全部播客', path: '/episodes' },
    { name: category.name, path: `/episodes?category=${encodeURIComponent(category.id)}` },
    { name: episode.title, path: episodePublicPath(episode.category, episode.slug) },
  ]);
}
