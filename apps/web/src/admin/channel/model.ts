import {
  orderedPromptSlots,
  type PromptSlotInput,
  type PromptSlotTable,
  promptSlotInputSchema,
} from '@his-fm/contracts';
import { z } from 'zod';

export const promptSlotsDraftSchema = z.object({
  version: z.number().int().min(0),
  slots: z.array(promptSlotInputSchema.extend({ title: z.string(), body: z.string() })).max(64),
});

export function slotInputs(table: PromptSlotTable): PromptSlotInput[] {
  return orderedPromptSlots(table.slots).map(({ id, title, body, order, enabled, mode }) => ({
    id,
    title,
    body,
    order,
    enabled,
    mode,
  }));
}

export function moveSlot(slots: PromptSlotInput[], id: string, direction: -1 | 1): PromptSlotInput[] {
  const next = orderedPromptSlots(slots);
  const index = next.findIndex((slot) => slot.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return slots;
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((slot, order) => ({ ...slot, order }));
}
