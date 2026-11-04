import type { PublicEpisodeSummary } from '../src/shared/episode';
import { projectPublicEpisodeSummary } from '../src/shared/episode';
import { episodeCanonicalUrl } from '../src/shared/episode-url';
import { programmeColumnDescription } from '../src/shared/public-copy';
import { filterIndexableEpisodes } from '../src/shared/public-index';
import { listCategories } from './categories';
import { readPublishedEpisodes } from './episodes';
import { getSiteSeo } from './seo-store';

function episodeLine(origin: string, episode: PublicEpisodeSummary) {
  return `- [${episode.title}](${episodeCanonicalUrl(origin, episode)}): ${episode.summary}`;
}

export async function buildLlmsFull(db: D1Database, origin: string) {
  const [siteRecord, categories] = await Promise.all([getSiteSeo(db), listCategories(db)]);
  const { version: _version, updatedAt: _updatedAt, updatedBy: _updatedBy, ...site } = siteRecord;
  const episodes = filterIndexableEpisodes(await readPublishedEpisodes(db), origin, site).map(
    projectPublicEpisodeSummary,
  );
  const description = programmeColumnDescription(categories);
  const sections = categories
    .map((category) => {
      const items = episodes.filter((episode) => episode.category === category.id);
      if (!items.length) return '';
      return `## ${category.name}\n\n${items.map((episode) => episodeLine(origin, episode)).join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');
  return `# ${site.siteName}

> ${description}

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

export async function buildLlmsTxt(db: D1Database, origin: string) {
  const [, categories] = await Promise.all([getSiteSeo(db), listCategories(db)]);
  const description = programmeColumnDescription(categories);
  const columnList = categories.map((category) => category.name).join('、') || '多个栏目';
  return `# his.fm

> ${description}

his.fm 是主理人李征的中文播客，设有 ${columnList} 等栏目。公开网站提供节目摘要、参考资料与 RSS；完整逐字稿仅保存在管理后台。

## Sister sites

- [lizheng.blog](https://lizheng.blog)
- [lizheng.dev](https://lizheng.dev)
- [lizheng.me](https://lizheng.me)
- [hexly.ai](https://hexly.ai)
- [basaltui.com](https://basaltui.com)

## Public discovery

- [Home](${origin}/)
- [All episodes](${origin}/episodes)
- [About](${origin}/about)
- [RSS](${origin}/feed.xml)
- [Expanded catalogue](${origin}/llms-full.txt)
- [Sitemap](${origin}/sitemap.xml)

## Editorial priority

Global prompt > selected category prompt > episode intent > source material. Authenticated agents must read current guidance before every creative task. Read ${origin}/api/agent/channel/prompt-slots and ${origin}/api/agent/categories/:id/prompt-slots with prompts:read; use ?slot=editor,collector for merged enabled roles. Prompt-slot writes require prompts:write and the current collection version.

## Agent API

- [Service discovery](${origin}/api/agent): Scoped external REST content management.
- [OpenAPI 3.1](${origin}/api/agent/openapi.json): Complete machine-readable contract.
- [API onboarding](${origin}/api/agent/instructions): Authentication, scopes, versioned content operations.

Discovery is public; all production data requires a studio-issued bearer token. Public pages and /api/episodes never include episode transcripts; authenticated agent and admin APIs retain them. This service does not expose MCP or A2A.
`;
}
