import { episodePublicPath } from '../src/shared/episode-url';
import { listCategories } from './categories';
import { listEpisodes } from './episodes';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(origin: string, path: string, lastmod?: string) {
  const loc = `${origin}${path}`;
  const modified = lastmod ? `\n    <lastmod>${escapeXml(lastmod.slice(0, 10))}</lastmod>` : '';
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${modified}\n  </url>`;
}

export async function buildSitemap(db: D1Database, origin: string) {
  const [episodes, categories] = await Promise.all([
    listEpisodes(db, true, undefined, origin),
    listCategories(db),
  ]);
  const staticPages = ['/', '/episodes', '/about'];
  const categoryPages = categories.map((category) => `/episodes?category=${encodeURIComponent(category.id)}`);
  const episodePages = episodes.map((episode) =>
    urlEntry(origin, episodePublicPath(episode.category, episode.slug), episode.updatedAt),
  );
  const entries = [
    ...staticPages.map((path) => urlEntry(origin, path)),
    ...categoryPages.map((path) => urlEntry(origin, path)),
    ...episodePages,
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}
