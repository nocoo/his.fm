import { type PromptKey, type PromptSlotInput, type PromptSlotTable, promptLabels } from '@his-fm/contracts';
import type { Category } from '../../shared/category';
import type { ChannelProfile } from '../../shared/channel';
import { request } from '../service';

export type MigrationPreview = {
  version: number;
  legacyVersion: number;
  initialized: boolean;
  slots: PromptSlotInput[];
  unmappedHeadings: string[];
};

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
  dryRun: (categoryId: string | null) =>
    request<MigrationPreview>(`${promptSlotsPath(categoryId)}/migration/dry-run`),
  apply: (categoryId: string | null, preview: MigrationPreview) =>
    request<PromptSlotTable>(`${promptSlotsPath(categoryId)}/migration/apply`, {
      method: 'POST',
      body: JSON.stringify({ version: preview.version, legacyVersion: preview.legacyVersion }),
    }),
  legacy: async (categoryId: string | null): Promise<{ title: string; body: string }[]> => {
    if (categoryId !== null) {
      const { category } = await request<{ category: Category }>(
        `/categories/${encodeURIComponent(categoryId)}`,
      );
      return [{ title: '旧版栏目提示词（只读）', body: category.prompt }];
    }
    const { channel } = await request<{ channel: ChannelProfile }>('/channel');
    return [
      { title: '旧版全局创作原则（只读）', body: channel.content },
      ...Object.entries(channel.prompts).map(([key, body]) => ({
        title: `${promptLabels[key as PromptKey]}（只读）`,
        body,
      })),
    ];
  },
};
