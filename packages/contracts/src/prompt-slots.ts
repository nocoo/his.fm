import { z } from 'zod';

export const initialPromptSlotTitles = {
  positioning: '定位',
  editor: '编辑',
  collector: '采集',
  voice: '声音',
  cover: '封面',
  producer: '制作',
  brand: '品牌',
  skills: '技能名称',
} as const;

export const promptSlotIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
export const promptSlotInputSchema = z.strictObject({
  id: promptSlotIdSchema,
  title: z.string().trim().min(1).max(120),
  body: z.string().max(120000),
  order: z.number().int().min(0).max(10000),
  enabled: z.boolean(),
  mode: z.enum(['override', 'append']),
});
export const promptSlotSchema = promptSlotInputSchema.extend({
  version: z.number().int().positive(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export const promptSlotTableSchema = z.strictObject({
  version: z.number().int().min(0),
  initialized: z.boolean(),
  slots: z.array(promptSlotSchema),
});
export const promptSlotInputsSchema = z
  .array(promptSlotInputSchema)
  .max(64)
  .superRefine((slots, ctx) => {
    if (new Set(slots.map((slot) => slot.id)).size !== slots.length)
      ctx.addIssue({ code: 'custom', message: '提示词槽 ID 不得重复' });
    if (slots.reduce((size, slot) => size + slot.body.length, 0) > 400000)
      ctx.addIssue({ code: 'custom', message: '提示词总长度不能超过 400000 字' });
    const skills = slots.find((slot) => slot.id === 'skills');
    if (
      skills?.body
        .split(/\r\n|\r|\n/)
        .some((line) => line.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(line.trim()))
    )
      ctx.addIssue({ code: 'custom', message: 'skills 只能逐行填写技能名称，不能填写指令' });
  });
export const promptSlotReplaceSchema = z.strictObject({
  version: z.number().int().min(0),
  slots: promptSlotInputsSchema,
});
export const promptSlotCreateSchema = promptSlotInputSchema.extend({ version: z.number().int().min(0) });
export const promptSlotPatchSchema = promptSlotInputSchema
  .omit({ id: true })
  .partial()
  .extend({
    version: z.number().int().min(0),
  })
  .refine((value) => Object.keys(value).length > 1, '请提供需要修改的提示词字段');
export const promptSlotApplySchema = z.strictObject({
  version: z.number().int().min(0),
  legacyVersion: z.number().int().min(0),
});

export type PromptSlotInput = z.infer<typeof promptSlotInputSchema>;
export type PromptSlot = z.infer<typeof promptSlotSchema>;
export type PromptSlotTable = z.infer<typeof promptSlotTableSchema>;

export function orderedPromptSlots<T extends PromptSlotInput>(slots: T[]): T[] {
  return [...slots].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function synthesizePromptSlots(slots: PromptSlotInput[]): string {
  return orderedPromptSlots(slots)
    .filter((slot) => slot.enabled && slot.body)
    .map((slot) => `## ${slot.title}\n\n${slot.body}`)
    .join('\n\n');
}

export function mergePromptSlots(channel: PromptSlotInput[], category: PromptSlotInput[]): PromptSlotInput[] {
  const merged = new Map(channel.filter((slot) => slot.enabled).map((slot) => [slot.id, slot]));
  for (const slot of category.filter((entry) => entry.enabled)) {
    const inherited = merged.get(slot.id);
    merged.set(slot.id, {
      ...slot,
      body:
        slot.mode === 'append' && inherited?.body
          ? [inherited.body, slot.body].filter(Boolean).join('\n\n')
          : slot.body,
    });
  }
  return orderedPromptSlots([...merged.values()]).map(({ id, title, body, order, enabled, mode }) => ({
    id,
    title,
    body,
    order,
    enabled,
    mode,
  }));
}
