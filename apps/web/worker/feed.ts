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

function enclosureMimeType(audioUrl: string, contentType?: string | null) {
  if (contentType === 'audio/mpeg' || contentType === 'audio/wav') return contentType;
  const lower = audioUrl.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/wav';
}

function mediaObjectKey(audioUrl: string) {
  return audioUrl.startsWith('/media/') ? audioUrl.slice('/media/'.length) : null;
}

async function enclosureForEpisode(
  bucket: R2Bucket | undefined,
  origin: string,
  mediaBase: string,
  episode: PublicEpisode,
  cache: Map<string, { length: number; type: string }>,
) {
  if (!episode.audioUrl) return null;
  const url = absoluteMedia(origin, mediaBase, episode.audioUrl);
  const cached = cache.get(url);
  if (cached) return cached;
  const key = mediaObjectKey(episode.audioUrl);
  let length = 0;
  let type = enclosureMimeType(episode.audioUrl);
  if (key && bucket) {
    const head = await bucket.head(key);
    if (head) {
      length = head.size;
      type = enclosureMimeType(episode.audioUrl, head.httpMetadata?.contentType);
    }
  }
  const meta = { length, type };
  cache.set(url, meta);
  return meta;
}

async function renderItem(
  origin: string,
  mediaBase: string,
  episode: PublicEpisode,
  bucket: R2Bucket | undefined,
  cache: Map<string, { length: number; type: string }>,
) {
  const link = absoluteUrl(origin, episodePublicPath(episode.category, episode.slug));
  const enclosureMeta = await enclosureForEpisode(bucket, origin, mediaBase, episode, cache);
  const audioUrl = episode.audioUrl;
  const enclosure =
    enclosureMeta && audioUrl
      ? `\n  <enclosure url="${escapeXml(absoluteMedia(origin, mediaBase, audioUrl))}" length="${enclosureMeta.length}" type="${escapeXml(enclosureMeta.type)}" />`
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
  bucket: R2Bucket | undefined,
  categoryName?: string,
) {
  const cache = new Map<string, { length: number; type: string }>();
  const items = (
    await Promise.all(episodes.map((episode) => renderItem(origin, mediaBase, episode, bucket, cache)))
  ).join('\n');
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

export async function buildRssFeed(
  db: D1Database,
  origin: string,
  mediaBase: string,
  bucket?: R2Bucket,
): Promise<string> {
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
    bucket,
  );
}

export async function buildCategoryRssFeed(
  db: D1Database,
  origin: string,
  mediaBase: string,
  categoryId: string,
  categoryName: string,
  bucket?: R2Bucket,
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
    bucket,
    categoryName,
  );
}
