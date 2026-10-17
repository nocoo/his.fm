import { z } from 'zod';

export const categoryIcons = [
  'briefcase-business',
  'book-open',
  'leaf',
  'messages-square',
  'mic',
  'code',
  'lightbulb',
  'coffee',
  'compass',
  'heart',
  'headphones',
  'sparkles',
] as const;
export const categoryColors = ['slate', 'blue', 'violet', 'teal', 'amber', 'rose'] as const;
export const categoryIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
export const categoryInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  icon: z.enum(categoryIcons),
  color: z.enum(categoryColors),
  prompt: z.string().trim().max(30000),
});
export const categoryUpdateSchema = categoryInputSchema.extend({ version: z.number().int().positive() });
export const categoryCreateSchema = categoryInputSchema.partial({ prompt: true });
export const categoryMutationSchema = categoryUpdateSchema
  .extend({ nextId: categoryIdSchema.optional() })
  .partial({ name: true, icon: true, color: true, prompt: true })
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), '请提供需要修改的栏目字段');
export const categorySchema = categoryUpdateSchema.extend({
  id: categoryIdSchema,
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export const publicCategorySchema = categorySchema.pick({ id: true, name: true, icon: true, color: true });
export type Category = z.infer<typeof categorySchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type PublicCategory = z.infer<typeof publicCategorySchema>;
