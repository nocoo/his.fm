import type { PromptSlotInput, PromptSlotTable } from '@his-fm/contracts';
import { request } from '../service';

export function promptSlotsPath(categoryId: string | null) {
  return `${categoryId === null ? '/channel' : `/categories/${encodeURIComponent(categoryId)}`}/prompt-slots`;
}

export const promptSlotsService = {
  get: (categoryId: string | null, signal?: AbortSignal) =>
    request<PromptSlotTable>(promptSlotsPath(categoryId), { signal }),
  save: (categoryId: string | null, version: number, slots: PromptSlotInput[]) =>
    request<PromptSlotTable>(promptSlotsPath(categoryId), {
      method: 'PUT',
      body: JSON.stringify({ version, slots }),
    }),
};
