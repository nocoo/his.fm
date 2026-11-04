import { themeChromeColor, themeFaviconPngSrc, themeFaviconSrc, themes } from '../src/brand/themes';
import { themeIdSchema } from '../src/shared/appearance';
import {
  CATALOGUE_PAGE_SIZE,
  cataloguePaginationLinks,
  parseCataloguePage,
} from '../src/shared/catalogue-pagination';
import { type PublicEpisode, projectPublicEpisode, projectPublicEpisodeSummary } from '../src/shared/episode';
import { withShareArtwork } from '../src/shared/episode-art';
import { episodePublicPath } from '../src/shared/episode-url';
import { PUBLIC_HTML_CACHE_CONTROL } from '../src/shared/public-cache-policy';
import { categoriesWithIndexableEpisodes, filterIndexableEpisodes } from '../src/shared/public-index';
import { injectSeoIntoHtml } from '../src/shared/seo-head';
import { episodeBreadcrumbs, podcastEpisodeJsonLd, podcastSeriesJsonLd } from '../src/shared/seo-jsonld';
import { resolveAboutPageSeo, resolveCatalogueSeo, resolveSiteDefaults } from '../src/shared/seo-resolve';
import { getAppearance } from './appearance';
import { listCategories } from './categories';
import { findPublishedEpisodeBySlug, redirect, resolveCategoryAlias } from './episode-public';
import { readPublishedEpisodes } from './episodes';
import { HttpError } from './http';
import { renderHeroPreloads, renderPublicPage } from './public-render';
import { getSiteSeo } from './seo-store';

const TRAKS_HEAD_SNIPPET = `<script>window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}</script>
<script defer data-site="pb_live_n79lt8f1ry7jcqhl4r74xmt9" src="https://track-collect.nocoo.cloud/t.js"></script>`;

async function loadShell(request: Request, env: Env) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  if (!asset.ok) throw new HttpError(503, '页面暂时无法加载，请稍后重试。');
  return asset.text();
}

function catalogueCategoryParam(categories: Awaited<ReturnType<typeof listCategories>>, raw: string | null) {
  if (!raw || raw === 'all') return { category: undefined, status: 200 as const };
  return categories.some((item) => item.id === raw)
    ? { category: categories.find((item) => item.id === raw), status: 200 as const }
    : { category: undefined, status: 404 as const };
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

  let siteRecord: Awaited<ReturnType<typeof getSiteSeo>>;
  let appearance: Awaited<ReturnType<typeof getAppearance>>;
  let records: Awaited<ReturnType<typeof readPublishedEpisodes>>;
  let categories: Awaited<ReturnType<typeof listCategories>>;
  let shell: string;
  try {
    [siteRecord, appearance, records, categories, shell] = await Promise.all([
      getSiteSeo(env.DB),
      getAppearance(env.DB),
      readPublishedEpisodes(env.DB),
      listCategories(env.DB),
      loadShell(request, env),
    ]);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'public_html_load_failed',
        path,
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    throw new HttpError(503, '页面暂时无法加载，请稍后重试。');
  }

  const { version: _version, updatedAt: _updatedAt, updatedBy: _updatedBy, ...site } = siteRecord;
  const indexableRecords = filterIndexableEpisodes(records, origin, site);
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const summaries = indexableRecords.map(projectPublicEpisodeSummary);
  const activeCategories = categoriesWithIndexableEpisodes(categories, summaries);
  let seo = resolveSiteDefaults(site, origin);
  let jsonLd: unknown[] = [podcastSeriesJsonLd(origin, site, activeCategories)];
  let episode: PublicEpisode | undefined;
  let extraHead = '';

  if (path === '/about') {
    seo = resolveAboutPageSeo(site, origin);
    jsonLd = [podcastSeriesJsonLd(origin, site, activeCategories)];
  } else if (path === '/episodes') {
    const rawCategory = url.searchParams.get('category');
    let categoryQuery = rawCategory;
    if (rawCategory && rawCategory !== 'all') {
      const canonicalId = await resolveCategoryAlias(env.DB, rawCategory);
      if (canonicalId !== rawCategory) {
        const next = new URL(url);
        next.searchParams.set('category', canonicalId);
        return redirect(`${next.pathname}${next.search}`);
      }
      categoryQuery = canonicalId;
    }
    const resolved = catalogueCategoryParam(categories, categoryQuery);
    if (resolved.status === 404) status = 404;
    const category = resolved.category;
    const page = parseCataloguePage(url.searchParams.get('page'));
    const categoryEpisodes =
      categoryQuery && categoryQuery !== 'all'
        ? summaries.filter((item) => item.category === categoryQuery)
        : summaries;
    if (category && categoryEpisodes.length === 0) status = 404;
    seo = resolveCatalogueSeo(site, origin, categoryEpisodes.length, category, category?.seo, page);
    extraHead = cataloguePaginationLinks(origin, category?.id ?? null, page, categoryEpisodes.length).join(
      '\n',
    );
    if (page > 1 && categoryEpisodes.length <= (page - 1) * CATALOGUE_PAGE_SIZE) status = 404;
  } else if (categoryEpisode) {
    const [, categoryId, slug] = categoryEpisode;
    const resolvedCategory = await resolveCategoryAlias(env.DB, categoryId);
    const record = indexableRecords.find((item) => item.category === resolvedCategory && item.slug === slug);
    if (!record) status = 404;
    else {
      episode = await withShareArtwork(
        projectPublicEpisode(record, origin, {
          site,
          categoryName: names.get(record.category) ?? record.category,
        }),
        origin,
      );
      const category = categories.find((item) => item.id === record.category);
      seo = episode.pageSeo;
      if (category) {
        jsonLd = [
          podcastSeriesJsonLd(origin, site, activeCategories),
          podcastEpisodeJsonLd(
            origin,
            episode,
            site,
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
    seo = { ...seo, title: '页面不存在 · his.fm', canonical: `${origin}${path}${url.search}`, noindex: true };
    jsonLd = [];
    extraHead = '';
  }

  const data = {
    origin,
    site,
    appearance: { theme: appearance.theme },
    episodes: summaries,
    episode,
    categories,
  };
  const preview = themeIdSchema.safeParse(url.searchParams.get('theme'));
  const theme = preview.success ? preview.data : appearance.theme;
  const chrome = themeChromeColor(theme, path, preview.success);
  const rendered = renderPublicPage(`${path}${url.search}`, data);
  const bootstrap = JSON.stringify(data).replace(/</g, '\\u003c');
  let html = injectSeoIntoHtml(shell, seo, jsonLd, origin, extraHead).replace(
    '<div id="root"></div>',
    () =>
      `<div id="root">${rendered}</div><script id="public-data" type="application/json">${bootstrap}</script>`,
  );
  html = html
    .replace(
      '<html',
      `<html data-public-theme="${theme}" style="--public-paper:${themes[theme].palette[0]};--public-chrome:${chrome}"`,
    )
    .replace(/<meta name="theme-color"[^>]*>\s*/g, '')
    .replace(/<link rel="icon"[^>]*>\s*/g, '')
    .replace(
      '</head>',
      `${TRAKS_HEAD_SNIPPET}<meta name="theme-color" content="${chrome}" /><link rel="icon" type="image/svg+xml" href="${themeFaviconSrc(theme)}" /><link rel="icon" type="image/png" sizes="32x32" href="${themeFaviconPngSrc(theme)}" /></head>`,
    );
  if (path === '/') {
    html = html.replace('</head>', `${renderHeroPreloads(theme)}</head>`);
  }
  const response = new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': status === 200 ? PUBLIC_HTML_CACHE_CONTROL : 'no-store',
    },
  });
  return request.method === 'HEAD' ? new Response(null, response) : response;
}
