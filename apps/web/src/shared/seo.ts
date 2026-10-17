import { z } from 'zod';

const mediaUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (/^\/(?:brand|images|media)\/[a-zA-Z0-9/_.-]+$/.test(value) && !value.includes('..')) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, '请使用 HTTPS 地址或站内图片、媒体路径');

export const seoOverrideSchema = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(320).optional(),
  ogImageUrl: mediaUrl.optional(),
  noindex: z.boolean().optional(),
});

export type SeoOverride = z.infer<typeof seoOverrideSchema>;

export const siteSeoSchema = z.strictObject({
  siteName: z.string().trim().min(1).max(80).default('his.fm'),
  titleSuffix: z.string().trim().max(80).default(' · his.fm'),
  defaultTitle: z.string().trim().min(1).max(120).default('his.fm · 世界很快，你可以慢慢来'),
  defaultDescription: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .default('his.fm，一档给开发者的中文播客。聊 AI，聊工作，也聊屏幕之外正在发生的生活。'),
  defaultOgImageUrl: mediaUrl.or(z.literal('')).default('/brand/share.jpg'),
  podcastDescription: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .default('一档给开发者的中文播客。聊 AI，聊工作，也聊屏幕之外正在发生的生活。'),
  podcastAuthor: z.string().trim().min(1).max(120).default('his.fm'),
  podcastAuthorType: z.enum(['Person', 'Organization']).default('Organization'),
  podcastAuthorUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    }, '请使用不含凭据的 HTTPS 主页地址')
    .or(z.literal(''))
    .default(''),
  podcastCoverUrl: mediaUrl
    .refine(
      (value) =>
        URL.canParse(value, 'https://his.fm') &&
        /\.(?:png|jpe?g)$/i.test(new URL(value, 'https://his.fm').pathname),
      { message: '播客封面请使用 PNG 或 JPEG 图片地址' },
    )
    .or(z.literal(''))
    .default(''),
  podcastOwnerEmail: z.string().trim().max(254).email().or(z.literal('')).default(''),
  language: z.string().trim().min(2).max(12).default('zh-CN'),
  itunesCategory: z.string().trim().min(1).max(80).default('Technology'),
  itunesExplicit: z.boolean().default(false),
  twitterSite: z.string().trim().max(80).optional(),
  overrides: seoOverrideSchema.partial().optional(),
});

export type SiteSeo = z.infer<typeof siteSeoSchema>;

export const siteSeoUpdateSchema = siteSeoSchema
  .extend({
    siteName: siteSeoSchema.shape.siteName.removeDefault(),
    titleSuffix: siteSeoSchema.shape.titleSuffix.removeDefault(),
    defaultTitle: siteSeoSchema.shape.defaultTitle.removeDefault(),
    defaultDescription: siteSeoSchema.shape.defaultDescription.removeDefault(),
    defaultOgImageUrl: siteSeoSchema.shape.defaultOgImageUrl.removeDefault(),
    podcastDescription: siteSeoSchema.shape.podcastDescription.removeDefault(),
    podcastAuthor: siteSeoSchema.shape.podcastAuthor.removeDefault(),
    podcastAuthorType: siteSeoSchema.shape.podcastAuthorType.removeDefault(),
    podcastAuthorUrl: siteSeoSchema.shape.podcastAuthorUrl.removeDefault(),
    podcastCoverUrl: siteSeoSchema.shape.podcastCoverUrl.removeDefault(),
    podcastOwnerEmail: siteSeoSchema.shape.podcastOwnerEmail.removeDefault(),
    language: siteSeoSchema.shape.language.removeDefault(),
    itunesCategory: siteSeoSchema.shape.itunesCategory.removeDefault(),
    itunesExplicit: siteSeoSchema.shape.itunesExplicit.removeDefault(),
  })
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();

export type SiteSeoUpdate = z.infer<typeof siteSeoUpdateSchema>;

export type SiteSeoRecord = SiteSeo & {
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export const emptySeoOverride = (): SeoOverride => ({});

export function parseSeoOverride(raw: string | SeoOverride | null | undefined): SeoOverride {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = seoOverrideSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }
  const parsed = seoOverrideSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
