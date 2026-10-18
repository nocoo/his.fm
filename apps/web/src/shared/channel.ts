import { promptKeys } from '@his-fm/contracts';
import { z } from 'zod';

export const editorialPriority = ['channel', 'category', 'intent', 'sources'] as const;
const version = z.number().int().min(1);
export const channelProfileSchema = z.strictObject({
  version,
  content: z.string(),
  prompts: z.record(z.enum(promptKeys), z.string()),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ChannelProfile = z.infer<typeof channelProfileSchema>;
