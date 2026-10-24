import { z } from 'zod';
import { categoryIdSchema } from './category';
import { episodeCanonicalUrl } from './episode-url';
import { mentionsSchema } from './mentions';
import { type SeoOverride, type SiteSeo, seoOverrideSchema, siteSeoSchema } from './seo';
import type { ResolvedPageSeo } from './seo-resolve';
import { resolveEpisodePageSeo, resolveSiteDefaults } from './seo-resolve';

const mediaUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (/^\/(?:images|media)\/[a-zA-Z0-9/_.-]+$/.test(value) && !value.includes('..')) {
      return true;
    }
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, '请使用 HTTPS 地址或站内图片、媒体路径');

const episodeSourceUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, '来源链接需使用 HTTPS 地址');

export const episodeTopicSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(2000).default(''),
  sourceUrls: z.array(episodeSourceUrl).max(8).default([]),
});
export const episodeTopicsSchema = z.array(episodeTopicSchema).max(30);
export type EpisodeTopic = z.infer<typeof episodeTopicSchema>;

const episodeBodySchema = z.strictObject({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '链接名称仅允许小写字母、数字和连字符'),
  episodeNumber: z.number().int().min(1).max(99999),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2000),
  transcript: z.string().max(100000),
  lead: z.string().max(4000).default(''),
  researchNote: z.string().max(4000).default(''),
  credits: z.string().max(4000).default(''),
  body: z.string().max(20000).default(''),
  topics: episodeTopicsSchema.default([]),
  showNotes: z.string().max(20000).default(''),
  coverUrl: mediaUrl,
  category: categoryIdSchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
  mentions: mentionsSchema.default([]),
  seo: seoOverrideSchema.default({}),
  durationSeconds: z.number().int().min(0).max(43200),
  audioUrl: mediaUrl.nullable(),
  status: z.enum(['draft', 'published']),
  featured: z.boolean(),
  publishedAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value).toISOString())
    .nullable(),
});

function requirePublishedAt(episode: {
  status: z.infer<typeof episodeBodySchema.shape.status>;
  publishedAt: string | null;
}) {
  return episode.status !== 'published' || episode.publishedAt !== null;
}

export const episodeInputSchema = episodeBodySchema.refine(requirePublishedAt, {
  message: '发布前请填写发布时间',
  path: ['publishedAt'],
});

export type EpisodeInput = z.infer<typeof episodeInputSchema>;
/** Writes may omit the legacy Markdown body; the worker keeps whatever is stored. */
export type EpisodeWriteInput = Omit<EpisodeInput, 'showNotes'> & { showNotes?: string };
export const episodeCreateSchema = episodeBodySchema
  .extend({ episodeNumber: episodeBodySchema.shape.episodeNumber.optional() })
  .refine(requirePublishedAt, {
    message: '发布前请填写发布时间',
    path: ['publishedAt'],
  });
export type EpisodeCreateInput = z.infer<typeof episodeCreateSchema>;
/**
 * Updates keep the legacy body, the mention list and the topic list when the caller omits them,
 * so a client that only edits structure cannot erase the parts it does not know about.
 */
export const episodeUpdateSchema = episodeBodySchema
  .extend({
    version: z.number().int().positive(),
    showNotes: episodeBodySchema.shape.showNotes.removeDefault().optional(),
    mentions: episodeBodySchema.shape.mentions.removeDefault().optional(),
    topics: episodeBodySchema.shape.topics.removeDefault().optional(),
  })
  .refine(requirePublishedAt, { message: '发布前请填写发布时间', path: ['publishedAt'] });
export const episodeDisplaySchema = z.strictObject({
  version: z.number().int().positive(),
  featured: z.boolean(),
});

export type Episode = EpisodeInput & {
  id: string;
  version: number;
  sourceProductionId?: string | null;
  seo: SeoOverride;
  createdAt: string;
  updatedAt: string;
};

/** Public catalogue and pages never include the full transcript or raw SEO overrides. */
export type PublicEpisode = Omit<Episode, 'transcript' | 'seo'> & {
  canonical: string;
  pageSeo: ResolvedPageSeo;
};

/**
 * Catalogue payloads stay small: the long-form body, source list and resolved SEO belong to the
 * single-episode endpoints and the server-rendered detail page.
 */
export type PublicEpisodeSummary = Pick<
  PublicEpisode,
  | 'id'
  | 'version'
  | 'slug'
  | 'episodeNumber'
  | 'title'
  | 'summary'
  | 'coverUrl'
  | 'category'
  | 'tags'
  | 'durationSeconds'
  | 'audioUrl'
  | 'featured'
  | 'publishedAt'
>;

export function projectPublicEpisodeSummary(episode: Episode): PublicEpisodeSummary {
  return {
    id: episode.id,
    version: episode.version,
    slug: episode.slug,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    summary: episode.summary,
    coverUrl: episode.coverUrl,
    category: episode.category,
    tags: episode.tags,
    durationSeconds: episode.durationSeconds,
    audioUrl: episode.audioUrl,
    featured: episode.featured,
    publishedAt: episode.publishedAt,
  };
}

export function projectPublicEpisode(
  episode: Episode,
  origin: string,
  context?: { site?: SiteSeo; categoryName?: string },
): PublicEpisode {
  const { transcript: _transcript, seo, ...publicEpisode } = episode;
  const canonical = episodeCanonicalUrl(origin, episode);
  const base = { ...publicEpisode, canonical };
  const site = context?.site ?? siteSeoSchema.parse({});
  const shell = { ...base, pageSeo: resolveSiteDefaults(site, origin) } as PublicEpisode;
  return {
    ...base,
    pageSeo: resolveEpisodePageSeo(site, origin, shell, seo),
  };
}
