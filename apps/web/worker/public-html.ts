import { formatEpisodeLabel } from '../src/shared/episode-display';
import { episodePublicPath } from '../src/shared/episode-url';
import { injectSeoIntoHtml } from '../src/shared/seo-head';
import { episodeBreadcrumbs, podcastEpisodeJsonLd, podcastSeriesJsonLd } from '../src/shared/seo-jsonld';
import {
  resolveAboutPageSeo,
  resolveCatalogueSeo,
  resolveEpisodePageSeo,
  resolveSiteDefaults,
} from '../src/shared/seo-resolve';
import { getCategory, listCategories } from './categories';
import { findPublishedEpisodeBySlug, redirect, resolveCategoryAlias } from './episode-public';
import { getPublishedEpisodeBundle } from './episodes';
import { getSiteSeo } from './seo-store';

async function loadShell(request: Request, env: Env) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  return asset.text();
}

export async function maybeServePublicHtml(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;
  const mediaBase = env.MEDIA_BASE_URL ?? 'https://f.no.mt';

  const legacyEpisode = /^\/episodes\/([^/]+)$/.exec(path);
  if (legacyEpisode && legacyEpisode[1] !== 'episodes') {
    const slug = legacyEpisode[1];
    const hit = await findPublishedEpisodeBySlug(env.DB, slug);
    if (hit) return redirect(`${origin}${episodePublicPath(hit.category, hit.slug)}`);
  }

  const categoryEpisode = /^\/episodes\/([^/]+)\/([^/]+)$/.exec(path);
  if (categoryEpisode) {
    const [, categoryId, slug] = categoryEpisode;
    const resolvedCategory = await resolveCategoryAlias(env.DB, categoryId);
    if (resolvedCategory !== categoryId) {
      return redirect(`${origin}${episodePublicPath(resolvedCategory, slug)}`);
    }
  }

  const needsHtml =
    path === '/' ||
    path === '/about' ||
    path === '/episodes' ||
    Boolean(categoryEpisode) ||
    Boolean(legacyEpisode);
  if (!needsHtml) return null;

  const site = await getSiteSeo(env.DB);
  let seo = resolveSiteDefaults(site, origin);
  let jsonLd: unknown[] = [podcastSeriesJsonLd(origin, site)];

  if (path === '/about') {
    seo = resolveAboutPageSeo(site, origin);
    jsonLd = [podcastSeriesJsonLd(origin, site)];
  } else if (path === '/episodes') {
    const categoryId = url.searchParams.get('category');
    const categories = await listCategories(env.DB);
    const category = categories.find((item) => item.id === categoryId);
    const categorySeo = category ? (await getCategory(env.DB, category.id)).seo : undefined;
    seo = resolveCatalogueSeo(site, origin, category, categorySeo);
  } else if (categoryEpisode) {
    const [, categoryId, slug] = categoryEpisode;
    const { episode, seo: episodeSeo } = await getPublishedEpisodeBundle(env.DB, categoryId, slug, origin);
    const categories = await listCategories(env.DB);
    const category = categories.find((item) => item.id === episode.category);
    const label = category
      ? formatEpisodeLabel(category.name, episode.episodeNumber)
      : `EP.${episode.episodeNumber}`;
    seo = resolveEpisodePageSeo(site, origin, episode, label, episodeSeo);
    if (category) {
      jsonLd = [
        podcastSeriesJsonLd(origin, site),
        podcastEpisodeJsonLd(
          origin,
          episode,
          episode.audioUrl
            ? /^https?:\/\//i.test(episode.audioUrl)
              ? episode.audioUrl
              : `${mediaBase}${episode.audioUrl.replace(/^\/media/, '')}`
            : null,
        ),
        episodeBreadcrumbs(origin, category, episode),
      ];
    }
  }

  const html = injectSeoIntoHtml(await loadShell(request, env), seo, jsonLd);
  const response = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
  return request.method === 'HEAD' ? new Response(null, response) : response;
}
