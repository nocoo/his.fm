import { episodePublicPath } from '../src/shared/episode-url';
import { filterIndexableEpisodes } from '../src/shared/public-index';
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

function latestTimestamp(values: string[]) {
  // biome-ignore lint/complexity/useMathMinMax: ISO timestamps compare lexicographically.
  return values.reduce((latest, value) => (value > latest ? value : latest), '');
}

export async function buildSitemap(db: D1Database, origin: string) {
  const [records, categories, siteRecord] = await Promise.all([
    readPublishedEpisodes(db),
    listCategories(db),
    getSiteSeo(db),
  ]);
  const { version: _version, updatedAt: siteUpdatedAt, updatedBy: _updatedBy, ...site } = siteRecord;
  const indexable = filterIndexableEpisodes(records, origin, site);
  const latestEpisodeUpdate = latestTimestamp(indexable.map((episode) => episode.updatedAt));
  const homeLastmod = latestTimestamp([siteUpdatedAt, latestEpisodeUpdate]);
  const staticPages = [
    { seo: resolveSiteDefaults(site, origin), lastmod: homeLastmod },
    { seo: resolveCatalogueSeo(site, origin, indexable.length), lastmod: homeLastmod },
    { seo: resolveAboutPageSeo(site, origin), lastmod: homeLastmod },
  ];
  const categoryPages = categories
    .map((category) => {
      const inCategory = indexable.filter((episode) => episode.category === category.id);
      if (!inCategory.length) return null;
      return {
        seo: resolveCatalogueSeo(site, origin, inCategory.length, category),
        lastmod: latestTimestamp(inCategory.map((episode) => episode.updatedAt)) || homeLastmod,
      };
    })
    .filter((page): page is NonNullable<typeof page> => page !== null);
  const episodePages = indexable.map((episode) =>
    urlEntry(`${origin}${episodePublicPath(episode.category, episode.slug)}`, episode.updatedAt),
  );
  const entries = [
    ...[...staticPages, ...categoryPages]
      .filter((page) => !page.seo.noindex)
      .map((page) => urlEntry(page.seo.canonical, page.lastmod)),
    ...episodePages,
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}
