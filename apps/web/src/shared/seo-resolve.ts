import type { PublicCategory } from './category';
import type { PublicEpisode } from './episode';
import { episodeCanonicalUrl } from './episode-url';
import type { SeoOverride, SiteSeo } from './seo';

export type ResolvedPageSeo = {
  title: string;
  description: string;
  canonical: string;
  ogImageUrl: string;
  noindex: boolean;
  ogType: 'website' | 'article' | 'music.song';
};

function absoluteAsset(origin: string, url: string) {
  if (/^https:\/\//.test(url)) return url;
  return `${origin}${url.startsWith('/') ? url : `/${url}`}`;
}

function mergeOverride(base: SeoOverride, ...layers: Array<SeoOverride | undefined>) {
  const merged = { ...base };
  for (const layer of layers) {
    if (layer) Object.assign(merged, layer);
  }
  return merged;
}

export function resolveSiteDefaults(site: SiteSeo, origin: string): ResolvedPageSeo {
  const merged = mergeOverride({}, site.overrides);
  return {
    title: merged.title ?? site.defaultTitle,
    description: merged.description ?? site.defaultDescription,
    canonical: `${origin}/`,
    ogImageUrl: absoluteAsset(origin, merged.ogImageUrl ?? site.defaultOgImageUrl),
    noindex: merged.noindex ?? false,
    ogType: 'website',
  };
}

export function resolveAboutPageSeo(site: SiteSeo, origin: string, override?: SeoOverride): ResolvedPageSeo {
  const base = resolveSiteDefaults(site, origin);
  const merged = mergeOverride({}, site.overrides, override);
  return {
    ...base,
    title: merged.title ?? '关于 his.fm · 代码之外，还有生活',
    description:
      merged.description ?? 'his.fm 是一档给开发者的中文播客，聊技术变化、工作节奏，也聊屏幕之外的生活。',
    canonical: `${origin}/about`,
    ogImageUrl: absoluteAsset(origin, merged.ogImageUrl ?? site.defaultOgImageUrl),
    noindex: merged.noindex ?? false,
  };
}

export function resolveCatalogueSeo(
  site: SiteSeo,
  origin: string,
  category?: PublicCategory,
  override?: SeoOverride,
): ResolvedPageSeo {
  const base = resolveSiteDefaults(site, origin);
  const merged = mergeOverride({}, site.overrides, override);
  if (category) {
    return {
      ...base,
      title: merged.title ?? `${category.name} · 全部播客${site.titleSuffix}`,
      description: merged.description ?? `浏览 his.fm「${category.name}」栏目的全部节目。`,
      canonical: `${origin}/episodes?category=${encodeURIComponent(category.id)}`,
      ogImageUrl: absoluteAsset(origin, merged.ogImageUrl ?? site.defaultOgImageUrl),
      noindex: merged.noindex ?? false,
    };
  }
  return {
    ...base,
    title: merged.title ?? `全部播客${site.titleSuffix}`,
    description: merged.description ?? '浏览 his.fm 全部已发布节目。',
    canonical: `${origin}/episodes`,
    ogImageUrl: absoluteAsset(origin, merged.ogImageUrl ?? site.defaultOgImageUrl),
    noindex: merged.noindex ?? false,
  };
}

export function resolveEpisodePageSeo(
  site: SiteSeo,
  origin: string,
  episode: PublicEpisode,
  label: string,
  override?: SeoOverride,
): ResolvedPageSeo {
  const merged = mergeOverride({}, site.overrides, override);
  const canonical = episodeCanonicalUrl(origin, episode);
  const title = merged.title ?? `${label} · ${episode.title}${site.titleSuffix}`;
  const description = merged.description ?? `${label} · ${episode.summary}`;
  const ogImage = merged.ogImageUrl ?? episode.coverUrl ?? site.defaultOgImageUrl;
  return {
    title,
    description,
    canonical,
    ogImageUrl: absoluteAsset(origin, ogImage),
    noindex: merged.noindex ?? false,
    ogType: 'article',
  };
}
