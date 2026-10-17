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
  return new URL(path, origin).href;
}

function absoluteMedia(origin: string, mediaBase: string, value: string) {
  const url = new URL(value, origin);
  if (url.origin === new URL(origin).origin && url.pathname.startsWith('/media/')) {
    const base = new URL(`${mediaBase.replace(/\/$/, '')}/`, origin);
    base.pathname += url.pathname.slice('/media/'.length);
    base.search = url.search;
    return base.href;
  }
  return url.href;
}

function itemDescription(episode: PublicEpisode) {
  const parts = [escapeXml(episode.summary)];
  const mentions = mentionsShowNotesHtml(episode.mentions);
  if (mentions) parts.push(mentions);
  return parts.join('\n');
}

function enclosureMimeType(audioUrl: string, contentType?: string) {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  if (type) return type === 'audio/mpeg' ? type : null;
  const path = new URL(audioUrl).pathname.toLowerCase();
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  return null;
}

function mediaObjectKey(origin: string, mediaBase: string, audioUrl: string) {
  if (!audioUrl.startsWith('/media/') && !/^https?:\/\//.test(audioUrl)) return null;
  try {
    const url = new URL(audioUrl, origin);
    const base = new URL(`${mediaBase.replace(/\/$/, '')}/`, origin);
    if (url.username || url.password || url.hash) return null;
    if (url.protocol !== 'https:' && url.origin !== new URL(origin).origin) return null;
    let path: string;
    if (url.origin === new URL(origin).origin && url.pathname.startsWith('/media/')) {
      path = url.pathname.slice('/media/'.length);
    } else if (url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
      path = url.pathname.slice(base.pathname.length);
    } else {
      return null;
    }
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

async function enclosureForEpisode(
  bucket: R2Bucket | undefined,
  origin: string,
  mediaBase: string,
  episode: PublicEpisode,
  cache: Map<string, Promise<R2Object | null>>,
) {
  if (!episode.audioUrl || !bucket) return null;
  const key = mediaObjectKey(origin, mediaBase, episode.audioUrl);
  if (!key) return null;
  const pending = cache.get(key) ?? bucket.head(key);
  cache.set(key, pending);
  const head = await pending;
  if (!head || !Number.isSafeInteger(head.size) || head.size <= 0) return null;
  const url = absoluteMedia(origin, mediaBase, episode.audioUrl);
  const type = enclosureMimeType(url, head.httpMetadata?.contentType);
  return type ? { url, length: head.size, type } : null;
}

async function renderItem(
  origin: string,
  mediaBase: string,
  episode: PublicEpisode,
  bucket: R2Bucket | undefined,
  cache: Map<string, Promise<R2Object | null>>,
) {
  const publishedAt = episode.publishedAt ? new Date(episode.publishedAt) : null;
  if (!episode.title.trim() || !publishedAt || !Number.isFinite(publishedAt.getTime())) return '';
  const enclosure = await enclosureForEpisode(bucket, origin, mediaBase, episode, cache);
  if (!enclosure) return '';
  const link = escapeXml(absoluteUrl(origin, episodePublicPath(episode.category, episode.slug)));
  const durationSeconds = Math.round(episode.durationSeconds);
  const duration =
    Number.isSafeInteger(durationSeconds) && durationSeconds > 0
      ? `\n  <itunes:duration>${durationSeconds}</itunes:duration>`
      : '';
  return `<item>
  <title>${escapeXml(episode.title)}</title>
  <link>${link}</link>
  <guid isPermaLink="true">${link}</guid>
  <pubDate>${publishedAt.toUTCString()}</pubDate>
  <description>${escapeXml(itemDescription(episode))}</description>
  <enclosure url="${escapeXml(enclosure.url)}" length="${enclosure.length}" type="${escapeXml(enclosure.type)}" />${duration}
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
) {
  const cache = new Map<string, Promise<R2Object | null>>();
  const items = (
    await Promise.all(episodes.map((episode) => renderItem(origin, mediaBase, episode, bucket, cache)))
  )
    .filter(Boolean)
    .join('\n');
  const image = site.podcastCoverUrl
    ? `\n    <itunes:image href="${escapeXml(absoluteMedia(origin, mediaBase, site.podcastCoverUrl))}" />`
    : '';
  const owner = site.podcastOwnerEmail
    ? `\n    <itunes:owner><itunes:name>${escapeXml(site.podcastAuthor)}</itunes:name><itunes:email>${escapeXml(site.podcastOwnerEmail)}</itunes:email></itunes:owner>`
    : '';
  const authorLink = site.podcastAuthorUrl
    ? `\n    <atom:author><atom:name>${escapeXml(site.podcastAuthor)}</atom:name><atom:uri>${escapeXml(site.podcastAuthorUrl)}</atom:uri></atom:author>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(absoluteUrl(origin, '/'))}</link>
    <description>${escapeXml(description)}</description>
    <language>${escapeXml(site.language)}</language>
    <itunes:author>${escapeXml(site.podcastAuthor)}</itunes:author>
    <itunes:summary>${escapeXml(description)}</itunes:summary>
    <itunes:explicit>${site.itunesExplicit}</itunes:explicit>${image}${owner}${authorLink}
    <itunes:category text="${escapeXml(site.itunesCategory)}" />
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
  const episodes = await listEpisodes(db, true, undefined, origin);
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
  );
}
