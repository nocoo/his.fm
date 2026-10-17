import { themeIdSchema } from '../src/shared/appearance';
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
import { getAppearance } from './appearance';
import { getCategory, listCategories } from './categories';
import { findPublishedEpisodeBySlug, redirect, resolveCategoryAlias } from './episode-public';
import { getPublishedEpisodeBundle, listEpisodes } from './episodes';
import { HttpError } from './http';
import { renderHeroPreloads, renderPublicPage } from './public-render';
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
  let status = 200;

  const legacyEpisode = /^\/episodes\/([^/]+)$/.exec(path);
  if (legacyEpisode) {
    const slug = legacyEpisode[1];
    const hit = await findPublishedEpisodeBySlug(env.DB, slug);
    if (hit) return redirect(`${origin}${episodePublicPath(hit.category, hit.slug)}`);
    status = 404;
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
  if (!needsHtml) {
    if (path.includes('.')) return null;
    status = 404;
  }

  const [siteRecord, appearance, episodes, categories] = await Promise.all([
    getSiteSeo(env.DB),
    getAppearance(env.DB),
    listEpisodes(env.DB, true, undefined, origin),
    listCategories(env.DB),
  ]);
  const { version: _version, updatedAt: _updatedAt, updatedBy: _updatedBy, ...site } = siteRecord;
  let seo = resolveSiteDefaults(site, origin);
  let jsonLd: unknown[] = [podcastSeriesJsonLd(origin, site)];

  if (path === '/about') {
    seo = resolveAboutPageSeo(site, origin);
    jsonLd = [podcastSeriesJsonLd(origin, site)];
  } else if (path === '/episodes') {
    const categoryId = url.searchParams.get('category');
    const category = categories.find((item) => item.id === categoryId);
    const categorySeo = category ? (await getCategory(env.DB, category.id)).seo : undefined;
    seo = resolveCatalogueSeo(site, origin, category, categorySeo);
  } else if (categoryEpisode) {
    const [, categoryId, slug] = categoryEpisode;
    const bundle = await getPublishedEpisodeBundle(env.DB, categoryId, slug, origin).catch((error) => {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    });
    if (!bundle) status = 404;
    else {
      const { episode, seo: episodeSeo } = bundle;
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
  }

  if (status === 404) {
    seo = { ...seo, title: '页面不存在 · his.fm', canonical: `${origin}${path}`, noindex: true };
    jsonLd = [];
  }

  const data = { origin, site, appearance: { theme: appearance.theme }, episodes, categories };
  const rendered = renderPublicPage(`${path}${url.search}`, data);
  const bootstrap = JSON.stringify(data).replace(/</g, '\\u003c');
  let html = injectSeoIntoHtml(await loadShell(request, env), seo, jsonLd).replace(
    '<div id="root"></div>',
    () =>
      `<div id="root">${rendered}</div><script id="public-data" type="application/json">${bootstrap}</script>`,
  );
  if (path === '/') {
    const preview = themeIdSchema.safeParse(url.searchParams.get('theme'));
    html = html.replace(
      '</head>',
      `${renderHeroPreloads(preview.success ? preview.data : appearance.theme)}</head>`,
    );
  }
  const nonce = crypto.randomUUID();
  if (env.ENVIRONMENT !== 'local') html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
  const response = new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...(env.ENVIRONMENT !== 'local'
        ? {
            'Content-Security-Policy': `base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'nonce-${nonce}'`,
          }
        : {}),
    },
  });
  return request.method === 'HEAD' ? new Response(null, response) : response;
}
