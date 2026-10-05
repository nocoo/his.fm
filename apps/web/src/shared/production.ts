import { z } from 'zod';
import { categoryIdSchema } from './category';

export { voices } from './voices';

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
export type Actor = { kind: 'human' | 'agent'; name: string };
export type Approval = { at: string; by: string };
export type ProductionAsset = {
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
export type AudioJob = {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  scriptVersion: number;
  createdAt: string;
  error: string | null;
};
export type Publication = {
  platform: 'wechat' | 'xiaoyuzhou';
  url: string;
  publishedAt: string;
  confirmedAt: string;
  confirmedBy: string;
  version: number;
};
export type ProductionEvent = { id: string; at: string; actor: Actor; action: string; feedback: string };
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
  audioJob: AudioJob | null;
  publications: Publication[];
  events: ProductionEvent[];
  createdAt: string;
  updatedAt: string;
};
export const publicationSchema = z.strictObject({
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
  publishedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
});
export const productionSettingsSchema = z.strictObject({
  provider: z.enum(['gemini', 'elevenlabs']),
  voice: z.string().trim().min(1).max(160),
  speakingStyle: z.string().trim().min(1).max(2000),
});
export const audioGenerationSchema = productionSettingsSchema
  .partial()
  .extend({
    version: z.number().int().min(1),
    introId: z.string().max(160).nullable().default(null),
    outroId: z.string().max(160).nullable().default(null),
  })
  .strict();
export type AudioGeneration = z.input<typeof audioGenerationSchema>;
export const audioPreviewSchema = productionSettingsSchema
  .extend({
    text: z.string().trim().min(1).max(200),
  })
  .strict();
export type AudioPreviewInput = z.infer<typeof audioPreviewSchema>;
export type AudioPreview = AudioPreviewInput & { url: string; durationSeconds: number; cached: boolean };
export type Bumper = { key: string; url: string; durationSeconds: number; size: number };
export type ProductionSettings = z.infer<typeof productionSettingsSchema> & {
  version: string;
  bumpers: BumperRecord[];
  ttsConfigured: boolean;
  providers: { gemini: boolean; elevenlabs: boolean };
  voices: { gemini: string; elevenlabs: string };
};
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
