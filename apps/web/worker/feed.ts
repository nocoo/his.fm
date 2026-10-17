import type { PublicEpisode } from '../src/shared/episode';
import { mentionsShowNotesHtml } from '../src/shared/mentions-format';
import { listEpisodes } from './episodes';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function itemDescription(episode: PublicEpisode) {
  const parts = [escapeXml(episode.summary)];
  const mentions = mentionsShowNotesHtml(episode.mentions);
  if (mentions) parts.push(mentions);
  return parts.join('\n');
}

export async function buildRssFeed(db: D1Database, origin: string): Promise<string> {
  const episodes = (await listEpisodes(db, true)) as PublicEpisode[];
  const items = episodes
    .map((episode) => {
      const link = `${origin}/episodes/${episode.slug}`;
      return `<item>
  <title>${escapeXml(episode.title)}</title>
  <link>${link}</link>
  <guid isPermaLink="true">${link}</guid>
  <pubDate>${new Date(episode.publishedAt ?? episode.updatedAt).toUTCString()}</pubDate>
  <description><![CDATA[${itemDescription(episode)}]]></description>
</item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>his.fm</title>
    <link>${origin}/</link>
    <description>一档给开发者的中文播客</description>
    <language>zh-CN</language>
    <atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;
}
