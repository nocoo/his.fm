import { type Episode, projectPublicEpisode } from '../../shared/episode';
import { withShareArtwork } from '../../shared/episode-art';
import type { Production } from '../../shared/production';
import type { SiteSeo } from '../../shared/seo';
import { resolveSiteDefaults } from '../../shared/seo-resolve';

export const socialPlatforms = [
  { id: 'x', label: 'X / Twitter' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'wechat', label: '微信聊天' },
  { id: 'slack', label: 'Slack' },
  { id: 'discord', label: 'Discord' },
  { id: 'imessage', label: 'iMessage' },
  { id: 'telegram', label: 'Telegram' },
] as const;

export type SocialPlatform = (typeof socialPlatforms)[number]['id'];

export async function episodeSocialPreview(
  site: SiteSeo,
  origin: string,
  episode: Episode,
  categoryName: string,
  saved?: Episode,
  now = Date.now(),
) {
  const { pageSeo: seo } = await withShareArtwork(
    projectPublicEpisode(episode, origin, { site, categoryName }),
    origin,
  );
  const publishedAt = saved?.publishedAt ? Date.parse(saved.publishedAt) : Number.NaN;
  const imageAvailable = Boolean(
    saved?.status === 'published' &&
      publishedAt <= now &&
      saved.id === episode.id &&
      saved.coverUrl === episode.coverUrl &&
      saved.seo.ogImageUrl === episode.seo.ogImageUrl,
  );
  return { seo, siteName: site.siteName, imageAvailable };
}

export function homepageSocialPreview(site: SiteSeo, saved: SiteSeo | null, origin: string) {
  const seo = resolveSiteDefaults(site, origin);
  return {
    seo,
    siteName: site.siteName,
    imageAvailable: saved !== null && resolveSiteDefaults(saved, origin).ogImageUrl === seo.ogImageUrl,
  };
}

export function productionPreviewEpisode(production: Production): Episode {
  return {
    id: production.id,
    sourceProductionId: production.id,
    version: production.version,
    title: production.title,
    slug: production.slug,
    episodeNumber: production.episodeNumber,
    category: production.category,
    summary: production.summary,
    transcript: production.transcript,
    topics: production.topics,
    lead: production.lead,
    researchNote: production.researchNote,
    credits: production.credits,
    body: production.body,
    tags: production.tags,
    mentions: production.mentions ?? [],
    seo: production.seo ?? {},
    coverUrl: production.assets.cover?.url ?? '',
    audioUrl: production.assets.audio?.url ?? null,
    durationSeconds: production.assets.audio?.durationSeconds ?? 0,
    featured: false,
    status: 'draft',
    publishedAt: null,
    createdAt: production.createdAt,
    updatedAt: production.updatedAt,
  };
}
