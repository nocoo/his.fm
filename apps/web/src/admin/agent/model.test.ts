import type { DraftProposal, PageContext, ServerFrame } from '@his-fm/contracts';
import { describe, expect, it } from 'vitest';
import { agentSocketUrl, canApplyProposal, initialAgentState, mergeDraft, reduceAgent } from './model';

const context: PageContext = {
  tabId: 'tab',
  pageEpoch: 1,
  seq: 3,
  route: '/admin/productions/one',
  productionId: 'one',
  step: 'script',
  sourceId: null,
  version: 1,
  field: { productionId: 'one', field: 'transcript' },
  draft: { revision: 2, value: 'draft', baseValue: 'base' },
  selection: { from: 0, to: 5, text: 'draft' },
  activity: 'editing',
};
const proposal: DraftProposal = {
  id: 'proposal',
  commandId: 'command',
  context,
  target: { productionId: 'one', field: 'transcript' },
  value: 'improved',
  summary: 'Improve the draft',
};
const snapshot: Extract<ServerFrame, { type: 'snapshot' }> = {
  type: 'snapshot',
  online: true,
  messages: [],
  conversations: [],
  commands: [],
  proposals: [],
};

describe('agent model', () => {
  it('selects only fixed same-origin websocket paths', () => {
    expect(agentSocketUrl('https://his.fm', false)).toBe('wss://his.fm/admin/api/agent/live?protocol=1');
    expect(agentSocketUrl('http://localhost:7056', true)).toBe(
      'ws://localhost:7056/admin/remote-api/agent/live?protocol=1',
    );
  });
  it('reduces every visible event, deduplicates and bounds messages', () => {
    let state = reduceAgent(initialAgentState, snapshot);
    expect(state.connection).toBe('ready');
    state = reduceAgent(state, { type: 'presence', online: false });
    expect(state.online).toBe(false);
    const conversations = [
      {
        id: 'main',
        role: 'coordinator',
        lifetime: 'coordinator' as const,
        status: 'working' as const,
        task: 'Draft',
        model: 'fake',
        thinkingLevel: 'low',
      },
    ];
    state = reduceAgent(state, { type: 'status', id: 'status', conversations });
    expect(state.conversations).toEqual(conversations);
    for (let index = 0; index < 202; index++)
      state = reduceAgent(state, {
        type: 'message',
        message: { id: String(index), role: 'assistant', text: 'reply', commandId: null, createdAt: 'now' },
      });
    expect(state.messages).toHaveLength(200);
    state = reduceAgent(state, { type: 'message', message: { ...state.messages[199], text: 'updated' } });
    expect(state.messages).toHaveLength(200);
    expect(state.messages.at(-1)?.text).toBe('updated');
    state = reduceAgent(state, {
      type: 'command.state',
      id: 'event',
      commandId: 'command',
      status: 'working',
      detail: 'Writing',
    });
    expect(state.commands[0].detail).toBe('Writing');
    state = reduceAgent(state, { type: 'proposal', proposal });
    state = reduceAgent(state, { type: 'proposal', proposal: { ...proposal, id: 'other' } });
    state = reduceAgent(state, { type: 'proposal.ack', id: proposal.id, status: 'applied' });
    expect(state.proposals.map((item) => item.id)).toEqual(['other']);
    state = reduceAgent(state, { type: 'error', code: 'failed', message: 'Try again' });
    expect(state.error).toBe('Try again');
    expect(reduceAgent(state, { type: 'pong' })).toBe(state);
  });
  it('requires the exact page, target, draft and selection for proposal application', () => {
    expect(canApplyProposal(proposal, context)).toBe(true);
    expect(canApplyProposal(proposal, null)).toBe(false);
    for (const changed of [
      { tabId: 'other' },
      { pageEpoch: 2 },
      { seq: 4 },
      { productionId: 'other' },
      { step: 'brief' as const },
      { sourceId: 'deleted' },
      { version: 2 },
      { route: '/other' },
      { draft: null },
      { activity: 'saving' as const },
      { activity: 'conflict' as const },
      { draft: { revision: 3, value: 'draft', baseValue: 'base' } },
      { draft: { revision: 2, value: 'edited', baseValue: 'base' } },
      { draft: { revision: 2, value: 'draft', baseValue: 'remote' } },
      { field: null },
      { selection: null },
    ])
      expect(canApplyProposal(proposal, { ...context, ...changed })).toBe(false);
    expect(canApplyProposal({ ...proposal, context: { ...context, draft: null } }, context)).toBe(false);
    expect(
      canApplyProposal({ ...proposal, target: { productionId: 'one', field: 'summary' } }, context),
    ).toBe(false);
  });
  it('refreshes clean fields, preserves dirty overlaps, accepts saved values', () => {
    const base = { title: 'Old', intent: 'Base', summary: 'Summary' };
    expect(mergeDraft(base, { ...base, intent: 'Draft' }, { ...base, title: 'New' })).toEqual({
      value: { ...base, title: 'New', intent: 'Draft' },
      conflicts: [],
    });
    expect(mergeDraft(base, { ...base, intent: 'Draft' }, { ...base, intent: 'Remote' }).conflicts).toEqual([
      'intent',
    ]);
    expect(mergeDraft(base, { ...base, intent: 'Draft' }, { ...base, intent: 'Draft' }).conflicts).toEqual(
      [],
    );
  });
  it('merges source fields by stable ID without losing edits, additions or removals', () => {
    const source = { id: 'one', title: 'Old', content: 'Base' };
    const other = { id: 'two', title: 'Other', content: 'Text' };
    const base = { sources: [source, other] };
    const dirty = { sources: [{ ...source, content: 'Draft' }, other] };
    const incoming = {
      sources: [
        { ...source, title: 'New' },
        { ...other, content: 'Remote' },
        { ...other, id: 'three' },
      ],
    };
    expect(mergeDraft(base, dirty, incoming)).toEqual({
      value: {
        sources: [{ ...source, title: 'New', content: 'Draft' }, incoming.sources[1], incoming.sources[2]],
      },
      conflicts: [],
    });
    expect(mergeDraft(base, dirty, { sources: [] })).toEqual({
      value: { sources: [dirty.sources[0]] },
      conflicts: ['sources'],
    });
    expect(mergeDraft(base, { sources: [] }, incoming).conflicts).toEqual(['sources']);
    expect(mergeDraft(base, { sources: [] }, base)).toEqual({ value: { sources: [] }, conflicts: [] });
    expect(mergeDraft({ sources: [] }, { sources: [source] }, { sources: [] }).value.sources).toEqual([
      source,
    ]);
    expect(mergeDraft({ sources: [] }, { sources: [source] }, { sources: [source] }).value.sources).toEqual([
      source,
    ]);
    expect(mergeDraft(base, dirty, { sources: [{ ...source, content: 'Remote' }, other] }).conflicts).toEqual(
      ['sources'],
    );
  });
});
