import { describe, expect, it } from 'vitest';
import {
  initialPromptSlotTitles,
  mergePromptSlots,
  orderedPromptSlots,
  type PromptSlotInput,
  promptSlotApplySchema,
  promptSlotCreateSchema,
  promptSlotIdSchema,
  promptSlotInputSchema,
  promptSlotInputsSchema,
  promptSlotPatchSchema,
  promptSlotReplaceSchema,
  promptSlotSchema,
  promptSlotTableSchema,
  synthesizePromptSlots,
} from './prompt-slots.ts';

const slot = (input: Partial<PromptSlotInput> = {}): PromptSlotInput => ({
  id: 'editor',
  title: 'Editor',
  body: 'Original Markdown.\n',
  order: 0,
  enabled: true,
  mode: 'append',
  ...input,
});

describe('prompt slot schemas', () => {
  it('defines the initial eight independently editable role identities', () => {
    expect(Object.keys(initialPromptSlotTitles)).toEqual([
      'positioning',
      'editor',
      'collector',
      'voice',
      'cover',
      'producer',
      'brand',
      'skills',
    ]);
    expect(Object.values(initialPromptSlotTitles).every((title) => title.length > 0)).toBe(true);
  });

  it.each(['a', 'editor', 'custom-role-2', '123', 'a'.repeat(80)])('accepts stable slug ID %s', (id) => {
    expect(promptSlotIdSchema.parse(id)).toBe(id);
  });

  it.each([
    '',
    'Editor',
    '-editor',
    'editor-',
    'editor--notes',
    'editor_notes',
    'editor/notes',
    '编辑',
    'a'.repeat(81),
  ])('rejects invalid stable ID %s', (id) => expect(promptSlotIdSchema.safeParse(id).success).toBe(false));

  it('validates complete slot input, trims only the title and preserves the Markdown body', () => {
    const input = slot({ title: '  Editor  ', body: '\r\n  Original Markdown.  \r\n\r\n' });
    expect(promptSlotInputSchema.parse(input)).toEqual({ ...input, title: 'Editor' });
    expect(
      promptSlotInputSchema.parse(slot({ body: '', order: 10000, mode: 'override', enabled: false })),
    ).toEqual(slot({ body: '', order: 10000, mode: 'override', enabled: false }));
    expect(
      promptSlotInputSchema.safeParse(slot({ title: 'a'.repeat(120), body: 'a'.repeat(120000) })).success,
    ).toBe(true);
    for (const property of Object.keys(slot())) {
      const input: Record<string, unknown> = { ...slot() };
      delete input[property];
      expect(promptSlotInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it.each([
    { title: '' },
    { title: '  ' },
    { title: 'a'.repeat(121) },
    { body: 'a'.repeat(120001) },
    { body: null },
    { order: -1 },
    { order: 0.5 },
    { order: 10001 },
    { enabled: 1 },
    { mode: 'merge' },
    { unexpected: true },
  ])('rejects malformed slot fields %j', (input) => {
    expect(promptSlotInputSchema.safeParse({ ...slot(), ...input }).success).toBe(false);
  });

  it('validates slot metadata and table versions without requiring an initialized table', () => {
    const saved = { ...slot(), version: 1, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: 'owner' };
    expect(promptSlotSchema.parse(saved)).toEqual(saved);
    expect(promptSlotSchema.safeParse({ ...saved, version: 0 }).success).toBe(false);
    expect(promptSlotSchema.safeParse({ ...saved, version: 1.5 }).success).toBe(false);
    expect(promptSlotSchema.safeParse({ ...saved, updatedAt: null }).success).toBe(false);
    expect(promptSlotSchema.safeParse({ ...saved, updatedBy: null }).success).toBe(false);
    expect(promptSlotSchema.safeParse({ ...saved, unexpected: true }).success).toBe(false);
    const table = { version: 3, initialized: true, slots: [saved] };
    expect(promptSlotTableSchema.parse(table)).toEqual(table);
    expect(promptSlotTableSchema.parse({ version: 0, initialized: false, slots: [] })).toEqual({
      version: 0,
      initialized: false,
      slots: [],
    });
    expect(promptSlotTableSchema.safeParse({ ...table, version: -1 }).success).toBe(false);
    expect(promptSlotTableSchema.safeParse({ ...table, initialized: undefined }).success).toBe(false);
    expect(promptSlotTableSchema.safeParse({ ...table, unexpected: true }).success).toBe(false);
  });

  it('bounds slot count, duplicate identities and total body size', () => {
    expect(promptSlotInputsSchema.parse([])).toEqual([]);
    const slots = Array.from({ length: 64 }, (_, index) => slot({ id: `slot-${index}` }));
    expect(promptSlotInputsSchema.safeParse(slots).success).toBe(true);
    expect(promptSlotInputsSchema.safeParse([...slots, slot({ id: 'extra' })]).success).toBe(false);
    expect(promptSlotInputsSchema.safeParse([slot(), slot()]).success).toBe(false);
    const large = Array.from({ length: 4 }, (_, index) =>
      slot({ id: `slot-${index}`, body: 'a'.repeat(100000) }),
    );
    expect(promptSlotInputsSchema.safeParse(large).success).toBe(true);
    expect(promptSlotInputsSchema.safeParse([...large, slot({ id: 'extra', body: 'a' })]).success).toBe(
      false,
    );
  });

  it('permits only newline-delimited skill names in the skills slot, not Markdown or instructions', () => {
    for (const body of ['', '\n\r\n', 'web-perf', '\r\n web-perf \r\nowner/repo.name_2\n']) {
      expect(promptSlotInputsSchema.safeParse([slot({ id: 'skills', body })]).success).toBe(true);
    }
    for (const body of [
      '## skills',
      '- web-perf',
      'Use web-perf first.',
      '技能',
      'name: commands',
      'a b',
      '_name',
    ]) {
      expect(promptSlotInputsSchema.safeParse([slot({ id: 'skills', body })]).success).toBe(false);
    }
    expect(
      promptSlotInputsSchema.safeParse([slot({ body: 'Arbitrary editorial prose is allowed.' })]).success,
    ).toBe(true);
  });

  it('requires optimistic versions for replace, create, patch and explicit migration apply', () => {
    expect(promptSlotReplaceSchema.parse({ version: 0, slots: [slot()] })).toEqual({
      version: 0,
      slots: [slot()],
    });
    expect(promptSlotReplaceSchema.safeParse({ slots: [] }).success).toBe(false);
    expect(promptSlotReplaceSchema.safeParse({ version: 0, slots: [slot(), slot()] }).success).toBe(false);
    expect(promptSlotReplaceSchema.safeParse({ version: -1, slots: [] }).success).toBe(false);
    expect(promptSlotReplaceSchema.safeParse({ version: 0, slots: [], unexpected: true }).success).toBe(
      false,
    );
    expect(promptSlotCreateSchema.parse({ ...slot(), version: 0 })).toEqual({ ...slot(), version: 0 });
    expect(promptSlotCreateSchema.safeParse(slot()).success).toBe(false);
    expect(promptSlotCreateSchema.safeParse({ ...slot(), version: -1 }).success).toBe(false);
    expect(promptSlotPatchSchema.parse({ version: 2, body: '' })).toEqual({ version: 2, body: '' });
    expect(
      promptSlotPatchSchema.parse({ version: 2, enabled: false, mode: 'override', order: 4, title: 'Title' }),
    ).toEqual({
      version: 2,
      enabled: false,
      mode: 'override',
      order: 4,
      title: 'Title',
    });
    expect(promptSlotPatchSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(promptSlotPatchSchema.safeParse({ body: 'Missing version' }).success).toBe(false);
    expect(promptSlotPatchSchema.safeParse({ version: 2, id: 'different' }).success).toBe(false);
    expect(promptSlotPatchSchema.safeParse({ version: -1, body: '' }).success).toBe(false);
    expect(promptSlotApplySchema.parse({ version: 0, legacyVersion: 11 })).toEqual({
      version: 0,
      legacyVersion: 11,
    });
    expect(promptSlotApplySchema.safeParse({ version: 0 }).success).toBe(false);
    expect(promptSlotApplySchema.safeParse({ version: 0, legacyVersion: -1 }).success).toBe(false);
    expect(promptSlotApplySchema.safeParse({ version: 0, legacyVersion: 11, unexpected: true }).success).toBe(
      false,
    );
  });
});

describe('orderedPromptSlots', () => {
  it('orders by explicit order then stable ID, without mutating the input or its metadata', () => {
    const a = { ...slot({ id: 'alpha', order: 2 }), version: 2 };
    const z = { ...slot({ id: 'zebra', order: 2 }), version: 1 };
    const first = { ...slot({ id: 'first', order: 0 }), version: 4 };
    const input = [z, a, first];
    expect(orderedPromptSlots(input)).toEqual([first, a, z]);
    expect(input).toEqual([z, a, first]);
    expect(orderedPromptSlots(input)[0]).toBe(first);
    expect(orderedPromptSlots([])).toEqual([]);
  });
});

describe('synthesizePromptSlots', () => {
  it('renders enabled nonempty bodies as ordered Markdown with unchanged bodies', () => {
    const input = [
      slot({ id: 'second', title: 'Second', order: 1, body: 'Second.\n' }),
      slot({ id: 'disabled', enabled: false, body: 'Do not expose this.' }),
      slot({ id: 'empty', body: '' }),
      slot({ id: 'first', title: 'First', body: '\n First.  \n' }),
    ];
    expect(synthesizePromptSlots(input)).toBe('## First\n\n\n First.  \n\n\n## Second\n\nSecond.\n');
    expect(synthesizePromptSlots([])).toBe('');
    expect(synthesizePromptSlots([slot({ enabled: false }), slot({ body: '' })])).toBe('');
  });
});

describe('mergePromptSlots', () => {
  it('appends category content to enabled same-ID channel content while using category metadata', () => {
    const channel = [slot({ title: 'Global editor', order: 9, body: 'Global.\n' })];
    const category = [slot({ title: 'Local editor', order: 1, body: '\nLocal.' })];
    expect(mergePromptSlots(channel, category)).toEqual([
      slot({ title: 'Local editor', order: 1, body: 'Global.\n\n\n\nLocal.' }),
    ]);
    expect(channel[0].body).toBe('Global.\n');
    expect(category[0].body).toBe('\nLocal.');
  });

  it('replaces inherited content in override mode, including an explicit empty override', () => {
    const channel = [slot({ body: 'Global.' })];
    expect(mergePromptSlots(channel, [slot({ mode: 'override', body: 'Local.' })])).toEqual([
      slot({ mode: 'override', body: 'Local.' }),
    ]);
    expect(mergePromptSlots(channel, [slot({ mode: 'override', body: '' })])).toEqual([
      slot({ mode: 'override', body: '' }),
    ]);
  });

  it('treats disabled category slots as absent, inherits enabled channel slots and omits disabled channel slots', () => {
    const channel = [slot(), slot({ id: 'voice', enabled: false })];
    const category = [slot({ enabled: false, mode: 'override', body: 'Ignored.' })];
    expect(mergePromptSlots(channel, category)).toEqual([channel[0]]);
    expect(mergePromptSlots([], category)).toEqual([]);
    expect(mergePromptSlots(channel, [slot({ id: 'voice', body: 'Local voice.' })])).toEqual([
      channel[0],
      slot({ id: 'voice', body: 'Local voice.' }),
    ]);
  });

  it('does not add separators for empty inherited or category bodies and supports category-only roles', () => {
    expect(mergePromptSlots([slot({ body: '' })], [slot({ body: 'Local.' })])).toEqual([
      slot({ body: 'Local.' }),
    ]);
    expect(mergePromptSlots([slot({ body: 'Global.' })], [slot({ body: '' })])).toEqual([
      slot({ body: 'Global.' }),
    ]);
    expect(mergePromptSlots([], [slot({ body: 'Local.' })])).toEqual([slot({ body: 'Local.' })]);
    expect(mergePromptSlots([slot({ body: '' })], [slot({ body: '' })])).toEqual([slot({ body: '' })]);
  });

  it('sorts inherited, overridden and category-only identities deterministically', () => {
    const channel = [slot({ id: 'zebra', order: 4 }), slot({ order: 9 }), slot({ id: 'first' })];
    const category = [slot({ order: 4, mode: 'override' }), slot({ id: 'alpha', order: 4 })];
    expect(mergePromptSlots(channel, category).map((entry) => entry.id)).toEqual([
      'first',
      'alpha',
      'editor',
      'zebra',
    ]);
    expect(mergePromptSlots([], [])).toEqual([]);
  });

  it('does not attach stored audit stamps to synthesized role bodies', () => {
    const stored = { ...slot(), version: 9, updatedAt: '2026-10-18', updatedBy: 'Original author' };
    const merged = mergePromptSlots([stored], [{ ...stored, body: 'Category text.' }]);
    expect(merged[0]).toEqual(slot({ body: 'Original Markdown.\n\n\nCategory text.' }));
    expect(promptSlotInputSchema.safeParse(merged[0]).success).toBe(true);
  });
});
