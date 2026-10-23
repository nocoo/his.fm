import { projectPublicEpisode } from '../src/shared/episode';
import { episodePublicPath } from '../src/shared/episode-url';
import { resolveAboutPageSeo, resolveCatalogueSeo, resolveSiteDefaults } from '../src/shared/seo-resolve';
import { listCategories } from './categories';
import { readPublishedEpisodes } from './episodes';
import { getSiteSeo } from './seo-store';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc: string, lastmod?: string) {
  const modified = lastmod ? `\n    <lastmod>${escapeXml(lastmod.slice(0, 10))}</lastmod>` : '';
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${modified}\n  </url>`;
}

export async function buildSitemap(db: D1Database, origin: string) {
  const [records, categories, site] = await Promise.all([
    readPublishedEpisodes(db),
    listCategories(db),
    getSiteSeo(db),
  ]);
  const staticPages = [
    resolveSiteDefaults(site, origin),
    resolveCatalogueSeo(site, origin, records.length),
    resolveAboutPageSeo(site, origin),
  ];
  const categoryPages = categories.map((category) =>
    resolveCatalogueSeo(
      site,
      origin,
      records.filter((episode) => episode.category === category.id).length,
      category,
    ),
  );
  const episodePages = records
    .filter((episode) => !projectPublicEpisode(episode, origin, { site }).pageSeo.noindex)
    .map((episode) =>
      urlEntry(`${origin}${episodePublicPath(episode.category, episode.slug)}`, episode.updatedAt),
    );
  const entries = [
    ...[...staticPages, ...categoryPages]
      .filter((page) => !page.noindex)
      .map((page) => urlEntry(page.canonical)),
    ...episodePages,
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}
