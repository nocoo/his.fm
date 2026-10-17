import { z } from 'zod';
import { seoOverrideSchema } from './seo';

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
export const categoryReservedIds = ['new', 'all'] as const;
export const categoryIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120)
  .refine((id) => !(categoryReservedIds as readonly string[]).includes(id), '栏目 ID 为系统保留标识');
export const categoryInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  icon: z.enum(categoryIcons),
  color: z.enum(categoryColors),
  prompt: z.string().trim().max(30000),
  seo: seoOverrideSchema.default({}),
});
export const categoryUpdateSchema = categoryInputSchema.extend({ version: z.number().int().positive() });
export const categoryCreateSchema = categoryInputSchema.partial({ prompt: true });
export const categoryMutationSchema = z
  .object({
    version: z.number().int().positive(),
    name: categoryInputSchema.shape.name.optional(),
    icon: categoryInputSchema.shape.icon.optional(),
    color: categoryInputSchema.shape.color.optional(),
    prompt: categoryInputSchema.shape.prompt.optional(),
    seo: seoOverrideSchema.optional(),
    nextId: categoryIdSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.icon !== undefined ||
      value.color !== undefined ||
      value.prompt !== undefined ||
      value.seo !== undefined ||
      value.nextId !== undefined,
    '请提供需要修改的栏目字段',
  );
export const categorySchema = categoryUpdateSchema.extend({
  id: categoryIdSchema,
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export const publicCategorySchema = categorySchema.pick({
  id: true,
  name: true,
  icon: true,
  color: true,
  seo: true,
});
export type Category = z.infer<typeof categorySchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type PublicCategory = z.infer<typeof publicCategorySchema>;
