import { z } from 'zod';

export const themeIds = [
  'grove',
  'interval',
  'soft-landing',
  'human-sample',
  'stillwood',
  'tidal-hours',
  'window-seat',
  'alpine-bloom',
] as const;

export const themeIdSchema = z.enum(themeIds);
export type ThemeId = z.infer<typeof themeIdSchema>;
export const publicAppearanceSchema = z.strictObject({ theme: themeIdSchema });
export const appearanceUpdateSchema = publicAppearanceSchema.extend({
  version: z.number().int().min(1),
});
export const appearanceSchema = appearanceUpdateSchema.extend({
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type PublicAppearance = z.infer<typeof publicAppearanceSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;
export type AppearanceUpdate = z.infer<typeof appearanceUpdateSchema>;
