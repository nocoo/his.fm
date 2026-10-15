import type { Principal, Scope } from '@his-fm/contracts';
import { z } from 'zod';
import { categoryIdSchema } from './category';

export const productionStages = [
  'draft',
  'brief_review',
  'scripting',
  'script_review',
  'production',
  'final_review',
  'ready',
] as const;
export type ProductionStage = (typeof productionStages)[number];
export const stageLabels: Record<ProductionStage, string> = {
  draft: '准备选题',
  brief_review: '确认选题',
  scripting: '创作逐字稿',
  script_review: '阅读逐字稿',
  production: '制作素材',
  final_review: '最终检查',
  ready: '可以发布',
};
export const sourceSchema = z
  .strictObject({
    id: z.string().min(1).max(160),
    type: z.enum(['url', 'github', 'text']),
    title: z.string().trim().max(200),
    content: z.string().trim().min(1).max(80000),
  })
  .refine(
    (source) => source.type === 'text' || /^https:\/\/[^\s]+$/.test(source.content),
    '素材链接需要使用 HTTPS',
  );
export const briefSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  episodeNumber: z.number().int().min(1).max(99999),
  category: categoryIdSchema.default('work'),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  targetDurationSeconds: z.number().int().min(60).max(1800).default(600),
  sources: z.array(sourceSchema).max(30).default([]),
  intent: z.string().trim().max(12000).default(''),
});
export type ProductionBrief = z.infer<typeof briefSchema>;
export const productionPatchSchema = briefSchema
  .partial()
  .extend({
    category: briefSchema.shape.category.removeDefault().optional(),
    tags: briefSchema.shape.tags.removeDefault().optional(),
    targetDurationSeconds: briefSchema.shape.targetDurationSeconds.removeDefault().optional(),
    sources: briefSchema.shape.sources.removeDefault().optional(),
    intent: briefSchema.shape.intent.removeDefault().optional(),
    version: z.number().int().min(1),
    transcript: z.string().max(50000).optional(),
    description: z.string().max(20000).optional(),
    summary: z.string().trim().max(2000).optional(),
  })
  .strict();
export const actionNames = [
  'submit_brief',
  'approve_brief',
  'revise_brief',
  'submit_script',
  'approve_script',
  'revise_script',
  'submit_final',
  'approve_final',
  'revise_assets',
  'reopen_script',
  'reopen_brief',
  'reopen_assets',
] as const;
export const productionActionSchema = z.strictObject({
  version: z.number().int().min(1),
  action: z.enum(actionNames),
  feedback: z.string().trim().max(12000).optional(),
  changes: productionPatchSchema.omit({ version: true }).optional(),
});
export type ProductionAction = z.infer<typeof productionActionSchema>;
export type Actor = Principal;
export type Approval = { at: string; by: string };
export type ProductionAsset = {
  source?: 'upload';
  key: string;
  url: string;
  mimeType: string;
  size: number;
  scriptVersion: number;
  createdAt: string;
  durationSeconds?: number;
  voice?: string;
  includesBumpers?: boolean;
};
export const publicationPlatforms = ['wechat', 'xiaoyuzhou', 'site'] as const;
export type PublicationPlatform = (typeof publicationPlatforms)[number];
export type Publication = {
  platform: PublicationPlatform;
  url: string;
  publishedAt: string;
  confirmedAt: string;
  confirmedBy: string;
  version: number;
};
export type ProductionEvent = {
  id: string;
  at: string;
  actor: Omit<Actor, 'scopes'> & { scopes?: string[] };
  action: string;
  feedback: string;
};
export type Production = ProductionBrief & {
  id: string;
  version: number;
  stage: ProductionStage;
  transcript: string;
  scriptVersion: number;
  description: string;
  summary: string;
  assets: { cover: ProductionAsset | null; audio: ProductionAsset | null };
  approvals: { brief: Approval | null; script: Approval | null; final: Approval | null };
  publications: Publication[];
  events: ProductionEvent[];
  createdAt: string;
  updatedAt: string;
};
const publicationPublishedAt = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const publicationSchema = z.union([
  z.strictObject({
    version: z.number().int().min(1),
    platform: z.literal('site'),
    publishedAt: publicationPublishedAt,
  }),
  z.strictObject({
    version: z.number().int().min(1),
    platform: z.enum(['wechat', 'xiaoyuzhou']),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      }),
    publishedAt: publicationPublishedAt,
  }),
]);
export type Bumper = { key: string; url: string; durationSeconds: number; size: number };
export type BumperRecord = Bumper & {
  id: string;
  name: string;
  position: 'intro' | 'outro';
  version: number;
};
export type AgentTokenRecord = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  scopes: Scope[];
  invalidScopes?: string[];
};
export type ProductionPrompts = { brief: string; script: string; cover: string; description: string };

export const agentActions = ['submit_brief', 'submit_script', 'submit_final'] as const;
export const agentActionSchema = z.strictObject({
  version: z.number().int().min(1),
  action: z.enum(agentActions),
  feedback: z.string().trim().max(12000).optional(),
});
export const agentEditableFields: Record<Production['stage'], string[]> = {
  draft: Object.keys(briefSchema.shape),
  scripting: ['transcript', 'category', 'tags'],
  production: ['description', 'summary', 'category', 'tags'],
  brief_review: [],
  script_review: [],
  final_review: [],
  ready: [],
};
