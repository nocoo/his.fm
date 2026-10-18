import { type PromptSlotInput, type PromptSlotTable, promptSlotReplaceSchema } from '@his-fm/contracts';
import { expect, it } from 'vitest';
import { moveSlot, promptSlotsDraftSchema, slotInputs } from './model';

const slot = (id: string, order: number): PromptSlotInput => ({
  id,
  order,
  title: id,
  body: id,
  enabled: true,
  mode: 'override',
});

it('projects ordered editable inputs without exposing audit or slot versions in mutation bodies', () => {
  const table: PromptSlotTable = {
    initialized: true,
    version: 9,
    slots: ['voice', 'editor'].map((id, order) => ({
      ...slot(id, 1 - order),
      version: 2,
      updatedAt: 'now',
      updatedBy: 'owner',
    })),
  };
  expect(slotInputs(table)).toEqual([slot('editor', 0), slot('voice', 1)]);
  expect(slotInputs(table)[0]).not.toHaveProperty('version');
});

it('moves stable identities and normalizes order without mutating the input', () => {
  const slots = [slot('voice', 20), slot('editor', 10), slot('brand', 30)];
  expect(moveSlot(slots, 'voice', -1)).toEqual([slot('voice', 0), slot('editor', 1), slot('brand', 2)]);
  expect(moveSlot(slots, 'voice', 1)).toEqual([slot('editor', 0), slot('brand', 1), slot('voice', 2)]);
  expect(slots[0].order).toBe(20);
  expect(moveSlot(slots, 'editor', -1)).toBe(slots);
  expect(moveSlot(slots, 'brand', 1)).toBe(slots);
  expect(moveSlot(slots, 'missing', 1)).toBe(slots);
});

it('retains temporary invalid drafts while keeping persisted identities and shape validated', () => {
  const draft = { version: 0, slots: [{ ...slot('skills', 0), title: '', body: '中'.repeat(120001) }] };
  expect(promptSlotsDraftSchema.safeParse(draft).success).toBe(true);
  expect(promptSlotReplaceSchema.safeParse(draft).success).toBe(false);
  expect(promptSlotsDraftSchema.safeParse({ ...draft, version: -1 }).success).toBe(false);
  expect(
    promptSlotsDraftSchema.safeParse({ version: 1, slots: [{ ...slot('invalid/id', 0) }] }).success,
  ).toBe(false);
});
