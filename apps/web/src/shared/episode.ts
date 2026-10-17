import { z } from 'zod';
import { categoryIdSchema } from './category';
import { episodeCanonicalUrl } from './episode-url';
import { mentionsSchema } from './mentions';

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
  showNotes: z.string().max(20000),
  coverUrl: mediaUrl,
  category: categoryIdSchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
  mentions: mentionsSchema.default([]),
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
export const episodeCreateSchema = episodeBodySchema
  .extend({ episodeNumber: episodeBodySchema.shape.episodeNumber.optional() })
  .refine(requirePublishedAt, {
    message: '发布前请填写发布时间',
    path: ['publishedAt'],
  });
export type EpisodeCreateInput = z.infer<typeof episodeCreateSchema>;
export const episodeUpdateSchema = episodeInputSchema.safeExtend({ version: z.number().int().positive() });
export const episodeDisplaySchema = z.strictObject({
  version: z.number().int().positive(),
  featured: z.boolean(),
});

export type Episode = EpisodeInput & {
  id: string;
  version: number;
  sourceProductionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Public catalogue and pages never include the full transcript. */
export type PublicEpisode = Omit<Episode, 'transcript'> & { canonical: string };

export function projectPublicEpisode(episode: Episode, origin = 'https://his.fm'): PublicEpisode {
  const { transcript: _transcript, ...publicEpisode } = episode;
  return { ...publicEpisode, canonical: episodeCanonicalUrl(origin, episode) };
}
