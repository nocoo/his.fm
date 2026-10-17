import { type PublicEpisode, projectPublicEpisode } from '../src/shared/episode';
import { categoryFeedPath, episodePublicPath } from '../src/shared/episode-url';
import { mentionsShowNotesHtml } from '../src/shared/mentions-format';
import { listEpisodes, listPublishedEpisodesInCategory } from './episodes';
import { getSiteSeo } from './seo-store';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absoluteUrl(origin: string, path: string) {
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

function absoluteMedia(origin: string, mediaBase: string, url: string) {
  if (/^https:\/\//.test(url)) return url;
  if (url.startsWith('/media/')) return `${mediaBase}${url.slice('/media'.length)}`;
  return absoluteUrl(origin, url);
}

function itemDescription(episode: PublicEpisode) {
  const parts = [escapeXml(episode.summary)];
  const mentions = mentionsShowNotesHtml(episode.mentions);
  if (mentions) parts.push(mentions);
  return parts.join('\n');
}

function renderItem(origin: string, mediaBase: string, episode: PublicEpisode) {
  const link = absoluteUrl(origin, episodePublicPath(episode.category, episode.slug));
  const enclosure = episode.audioUrl
    ? `\n  <enclosure url="${escapeXml(absoluteMedia(origin, mediaBase, episode.audioUrl))}" length="0" type="audio/mpeg" />`
    : '';
  return `<item>
  <title>${escapeXml(episode.title)}</title>
  <link>${link}</link>
  <guid isPermaLink="true">${link}</guid>
  <pubDate>${new Date(episode.publishedAt ?? episode.updatedAt).toUTCString()}</pubDate>
  <description><![CDATA[${itemDescription(episode)}]]></description>${enclosure}
</item>`;
}

async function buildChannel(
  origin: string,
  mediaBase: string,
  title: string,
  description: string,
  selfHref: string,
  episodes: PublicEpisode[],
  site: Awaited<ReturnType<typeof getSiteSeo>>,
  categoryName?: string,
) {
  const items = episodes.map((episode) => renderItem(origin, mediaBase, episode)).join('\n');
  const image = absoluteMedia(origin, mediaBase, site.defaultOgImageUrl);
  const categoryTag = categoryName
    ? `\n    <itunes:category text="${escapeXml(site.itunesCategory)}"><itunes:category text="${escapeXml(categoryName)}" /></itunes:category>`
    : `\n    <itunes:category text="${escapeXml(site.itunesCategory)}" />`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${absoluteUrl(origin, '/')}</link>
    <description>${escapeXml(description)}</description>
    <language>${escapeXml(site.language)}</language>
    <itunes:author>${escapeXml(site.podcastAuthor)}</itunes:author>
    <itunes:summary>${escapeXml(description)}</itunes:summary>
    <itunes:explicit>${site.itunesExplicit ? 'yes' : 'clean'}</itunes:explicit>
    <itunes:image href="${escapeXml(image)}" />${categoryTag}
    <atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;
}

export async function buildRssFeed(db: D1Database, origin: string, mediaBase: string): Promise<string> {
  const site = await getSiteSeo(db);
  const episodes = (await listEpisodes(db, true, undefined, origin)) as PublicEpisode[];
  return buildChannel(
    origin,
    mediaBase,
    site.siteName,
    site.podcastDescription,
    absoluteUrl(origin, '/feed.xml'),
    episodes,
    site,
  );
}

export async function buildCategoryRssFeed(
  db: D1Database,
  origin: string,
  mediaBase: string,
  categoryId: string,
  categoryName: string,
): Promise<string> {
  const site = await getSiteSeo(db);
  const episodes = (await listPublishedEpisodesInCategory(db, categoryId)).map((episode) =>
    projectPublicEpisode(episode, origin, { site, categoryName }),
  );
  return buildChannel(
    origin,
    mediaBase,
    `${categoryName} · ${site.siteName}`,
    `${categoryName} 栏目节目更新`,
    absoluteUrl(origin, categoryFeedPath(categoryId)),
    episodes,
    site,
    categoryName,
  );
}
