import type { PublicCategory } from './category';
import type { PublicEpisode } from './episode';
import { episodeCanonicalUrl, episodePublicPath } from './episode-url';
import { podcastEpisodeMentionsJsonLd } from './mentions-format';
import type { SiteSeo } from './seo';

export function podcastSeriesJsonLd(origin: string, site: SiteSeo) {
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: site.siteName,
    description: site.podcastDescription,
    url: `${origin}/`,
    inLanguage: site.language,
    author: { '@type': site.podcastAuthorType, name: site.podcastAuthor },
  };
}

export function podcastEpisodeJsonLd(
  origin: string,
  episode: PublicEpisode,
  audioAbsoluteUrl?: string | null,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: episode.title,
    description: episode.summary,
    url: episodeCanonicalUrl(origin, episode),
    datePublished: episode.publishedAt ?? episode.updatedAt,
    ...(audioAbsoluteUrl
      ? { associatedMedia: { '@type': 'MediaObject', contentUrl: audioAbsoluteUrl } }
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
