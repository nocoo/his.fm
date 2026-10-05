import { promptSetSchema } from '@his-fm/contracts';
import { z } from 'zod';

export const editorialPriority = ['channel', 'category', 'intent', 'sources'] as const;
const content = z.string().trim().min(1).max(30000);
const version = z.number().int().min(1);
export const channelUpdateSchema = z
  .strictObject({
    version,
    content: content.optional(),
    prompts: promptSetSchema.optional(),
  })
  .refine((value) => value.content !== undefined || value.prompts !== undefined, '请选择要保存的提示词');
export const channelProfileSchema = z.strictObject({
  version,
  content,
  prompts: promptSetSchema,
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ChannelProfile = z.infer<typeof channelProfileSchema>;
