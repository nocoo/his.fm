import type { PublicEpisodeSummary } from '../src/shared/episode';
import { episodeCanonicalUrl } from '../src/shared/episode-url';
import { listCategories } from './categories';
import { listPublishedEpisodeSummaries } from './episodes';
import { getSiteSeo } from './seo-store';

function episodeLine(origin: string, episode: PublicEpisodeSummary) {
  return `- [${episode.title}](${episodeCanonicalUrl(origin, episode)}): ${episode.summary}`;
}

export async function buildLlmsFull(db: D1Database, origin: string) {
  const [site, categories, episodes] = await Promise.all([
    getSiteSeo(db),
    listCategories(db),
    listPublishedEpisodeSummaries(db),
  ]);
  const sections = categories
    .map((category) => {
      const items = episodes.filter((episode) => episode.category === category.id);
      if (!items.length) return '';
      return `## ${category.name}\n\n${items.map((episode) => episodeLine(origin, episode)).join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');
  return `# ${site.siteName}

> ${site.podcastDescription}

## Public catalogue

- [Home](${origin}/)
- [All episodes](${origin}/episodes)
- [About](${origin}/about)
- [RSS](${origin}/feed.xml)
- [Sitemap](${origin}/sitemap.xml)
- [Agent API](${origin}/api/agent)

Public pages and \`/api/episodes\` never include full transcripts. Authenticated admin and agent APIs retain transcripts.

## Episodes by category

${sections || '_No published episodes yet._'}
`;
}
