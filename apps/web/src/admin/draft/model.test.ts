import { describe, expect, it } from 'vitest';
import { mergeDraft } from './model';

describe('editor draft reconciliation without a runtime provider', () => {
  it('merges unrelated server saves, preserves pending inputs and flags same-field conflicts', () => {
    const base = { title: 'Before', intent: 'Original' };
    expect(mergeDraft(base, { ...base, intent: 'Draft' }, { ...base, title: 'Remote' })).toEqual({
      value: { title: 'Remote', intent: 'Draft' },
      conflicts: [],
    });
    expect(mergeDraft(base, { ...base, intent: 'Draft' }, { ...base, intent: 'Remote' }).conflicts).toEqual([
      'intent',
    ]);
    expect(mergeDraft(base, { ...base, intent: 'Draft' }, { ...base, intent: 'Draft' }).conflicts).toEqual(
      [],
    );
  });
  it('reconciles stable source identities across additions, edits and removals without dropping drafts', () => {
    const source = { id: 'one', title: 'Before', content: 'Original' };
    const second = { id: 'two', title: 'Second', content: 'New' };
    const base = { sources: [source] };
    expect(
      mergeDraft(
        base,
        { sources: [{ ...source, content: 'Draft' }] },
        { sources: [{ ...source, title: 'Remote' }, second] },
      ),
    ).toEqual({
      value: { sources: [{ ...source, title: 'Remote', content: 'Draft' }, second] },
      conflicts: [],
    });
    expect(mergeDraft(base, base, { sources: [] })).toEqual({ value: { sources: [] }, conflicts: [] });
    expect(mergeDraft(base, { sources: [{ ...source, content: 'Draft' }] }, { sources: [] })).toEqual({
      value: { sources: [{ ...source, content: 'Draft' }] },
      conflicts: ['sources'],
    });
    expect(
      mergeDraft(base, { sources: [] }, { sources: [{ ...source, content: 'Remote' }] }).conflicts,
    ).toEqual(['sources']);
    expect(mergeDraft(base, { sources: [] }, base)).toEqual({ value: { sources: [] }, conflicts: [] });
    expect(mergeDraft({ sources: [] }, { sources: [source] }, { sources: [] }).value.sources).toEqual([
      source,
    ]);
    expect(mergeDraft({ sources: [] }, { sources: [source] }, { sources: [source] }).value.sources).toEqual([
      source,
    ]);
    expect(
      mergeDraft(
        base,
        { sources: [{ ...source, content: 'Draft' }] },
        { sources: [{ ...source, content: 'Remote' }] },
      ).conflicts,
    ).toEqual(['sources']);
  });
});
