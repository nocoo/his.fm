import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { PublicEpisode } from '../src/shared/episode';
import { artLocation } from '../src/shared/episode-art';
import { categoryFeedPath, episodePublicPath } from '../src/shared/episode-url';
import type { Mention } from '../src/shared/mentions';
import { getAppearance } from './appearance';
import { HttpError } from './http';
import { getSiteSeo } from './seo-store';

type FeedEpisode = Pick<
  PublicEpisode,
  | 'id'
  | 'title'
  | 'slug'
  | 'category'
  | 'summary'
  | 'mentions'
  | 'audioUrl'
  | 'durationSeconds'
  | 'publishedAt'
  | 'coverUrl'
  | 'episodeNumber'
> & { guid: string; categoryName: string };

async function feedEpisodes(db: D1Database, category?: string): Promise<FeedEpisode[]> {
  const result = await db
    .prepare(
      `SELECT e.id, e.title, e.slug, e.category, e.summary, e.mentions, e.audio_url AS audioUrl,
      e.duration_seconds AS durationSeconds, e.published_at AS publishedAt, e.cover_url AS coverUrl,
      e.episode_number AS episodeNumber, c.name AS categoryName,
      COALESCE(e.rss_guid, 'urn:his.fm:episode:' || e.id) AS guid
    FROM episodes e JOIN categories c ON c.id = e.category
    WHERE e.status = 'published' AND e.published_at <= ?${category ? ' AND e.category = ?' : ''}
    ORDER BY e.published_at DESC, e.episode_number DESC`,
    )
    .bind(new Date().toISOString(), ...(category ? [category] : []))
    .all<Omit<FeedEpisode, 'mentions'> & { mentions: string }>();
  if (!result.success) throw new HttpError(503, '播客订阅暂时无法读取');
  return result.results.map((row) => ({ ...row, mentions: JSON.parse(row.mentions) as Mention[] }));
}

export function podcastGuid(path: string) {
  const namespace = Buffer.from('ead4c236bf5858c6a2c6a6b28d128cb6', 'hex');
  const bytes = createHash('sha1').update(namespace).update(`his.fm${path}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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

export function absoluteMedia(origin: string, mediaBase: string, value: string) {
  const url = new URL(value, origin);
  if (url.origin === new URL(origin).origin && url.pathname.startsWith('/media/')) {
    const base = new URL(`${mediaBase.replace(/\/$/, '')}/`, origin);
    base.pathname += url.pathname.slice('/media/'.length);
    base.search = url.search;
    return base.href;
  }
  return url.href;
}

function itemDescription(episode: FeedEpisode, link: string) {
  let text = '';
  for (const character of episode.summary) {
    const escaped = escapeXml(character);
    if (text.length + escaped.length > 8000) break;
    text += escaped;
  }
  const summary = `<p>${text}</p>`;
  if (!episode.mentions.length) return summary;
  const start = `${summary}<p>本期提到</p><ul>`;
  const more = `<p><a href="${link}">完整节目介绍与相关链接</a></p>`;
  let result = start;
  for (const mention of episode.mentions) {
    const label = `${escapeXml(mention.name)} — ${escapeXml(mention.description)}`;
    const item = `<li>${mention.url ? `<a href="${escapeXml(mention.url)}">${label}</a>` : label}</li>`;
    if (result.length + item.length + '</ul>'.length + more.length > 10000) break;
    result += item;
  }
  return result === start ? `${summary}${more}` : `${result}</ul>${more}`;
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

export async function enclosureForEpisode(
  bucket: R2Bucket | undefined,
  origin: string,
  mediaBase: string,
  episode: Pick<PublicEpisode, 'audioUrl'>,
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
  episode: FeedEpisode,
  bucket: R2Bucket | undefined,
  cache: Map<string, Promise<R2Object | null>>,
  artUrl: string,
  explicit: boolean,
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
  <guid isPermaLink="${episode.guid.startsWith('https://')}">${escapeXml(episode.guid)}</guid>
  <pubDate>${publishedAt.toUTCString()}</pubDate>
  <description><![CDATA[${itemDescription(episode, link).replaceAll(']]>', ']]]]><![CDATA[>')}]]></description>
  <itunes:explicit>${explicit}</itunes:explicit>
  <itunes:image href="${escapeXml(absoluteUrl(origin, artUrl))}" />
  <enclosure url="${escapeXml(enclosure.url)}" length="${enclosure.length}" type="${escapeXml(enclosure.type)}" />${duration}
</item>`;
}

async function buildChannel(
  db: D1Database,
  origin: string,
  mediaBase: string,
  title: string,
  description: string,
  selfHref: string,
  identityPath: string,
  episodes: FeedEpisode[],
  site: Awaited<ReturnType<typeof getSiteSeo>>,
  bucket: R2Bucket | undefined,
) {
  const cache = new Map<string, Promise<R2Object | null>>();
  const { theme } = await getAppearance(db);
  const artwork = new Map(
    await Promise.all(
      episodes.map(
        async (record) =>
          [record.id, (await artLocation({ ...record, resource: 'episodes' }, theme)).url] as const,
      ),
    ),
  );
  const items = (
    await Promise.all(
      episodes.map((episode) =>
        renderItem(
          origin,
          mediaBase,
          episode,
          bucket,
          cache,
          artwork.get(episode.id) ?? `/episodes/${encodeURIComponent(episode.id)}/art.jpg`,
          site.itunesExplicit,
        ),
      ),
    )
  )
    .filter(Boolean)
    .join('\n');
  const image = `\n    <itunes:image href="${escapeXml(absoluteMedia(origin, mediaBase, site.podcastCoverUrl || '/brand/podcast.jpg'))}" />`;
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
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(absoluteUrl(origin, '/'))}</link>
    <description>${escapeXml(description)}</description>
    <language>${escapeXml(site.language)}</language>
    <itunes:author>${escapeXml(site.podcastAuthor)}</itunes:author>
    <itunes:summary>${escapeXml(description)}</itunes:summary>
    <itunes:explicit>${site.itunesExplicit}</itunes:explicit>${image}${owner}${authorLink}
    <itunes:category text="${escapeXml(site.itunesCategory)}" />
    <podcast:guid>${podcastGuid(identityPath)}</podcast:guid>
    <podcast:locked>no</podcast:locked>
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
  const [site, episodes] = await Promise.all([getSiteSeo(db), feedEpisodes(db)]);
  return buildChannel(
    db,
    origin,
    mediaBase,
    site.siteName,
    site.podcastDescription,
    absoluteUrl(origin, '/feed.xml'),
    '/feed.xml',
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
  const [site, episodes, identity] = await Promise.all([
    getSiteSeo(db),
    feedEpisodes(db, categoryId),
    db
      .prepare('SELECT rss_identity FROM categories WHERE id = ?')
      .bind(categoryId)
      .first<{ rss_identity: string | null }>(),
  ]);
  if (!identity?.rss_identity) throw new HttpError(503, '栏目订阅标识暂时不可用');
  return buildChannel(
    db,
    origin,
    mediaBase,
    `${categoryName} · ${site.siteName}`,
    `${categoryName} · ${site.podcastDescription}`,
    absoluteUrl(origin, categoryFeedPath(categoryId)),
    categoryFeedPath(identity.rss_identity),
    episodes,
    site,
    bucket,
  );
}
