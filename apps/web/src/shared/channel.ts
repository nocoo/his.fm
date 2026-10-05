import { z } from 'zod';

export const editorialPriority = ['channel', 'category', 'intent', 'sources'] as const;
export const channelUpdateSchema = z.strictObject({
  version: z.number().int().min(1),
  content: z.string().trim().min(1).max(30000),
});
export const channelProfileSchema = channelUpdateSchema.extend({
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ChannelProfile = z.infer<typeof channelProfileSchema>;
