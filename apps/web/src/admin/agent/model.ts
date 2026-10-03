import type {
  AgentMessage,
  ConversationStatus,
  DraftProposal,
  PageContext,
  ServerFrame,
} from '@his-fm/contracts';

export type AgentState = {
  connection: 'connecting' | 'ready' | 'offline' | 'blocked';
  online: boolean;
  messages: AgentMessage[];
  conversations: ConversationStatus[];
  commands: { id: string; status: string; detail: string }[];
  proposals: DraftProposal[];
  error: string;
};

export const initialAgentState: AgentState = {
  connection: 'connecting',
  online: false,
  messages: [],
  conversations: [],
  commands: [],
  proposals: [],
  error: '',
};

function upsert<T extends { id: string }>(items: T[], item: T, limit: number): T[] {
  return [...items.filter((current) => current.id !== item.id), item].slice(-limit);
}

export function reduceAgent(state: AgentState, frame: ServerFrame): AgentState {
  switch (frame.type) {
    case 'snapshot':
      return {
        ...state,
        connection: 'ready',
        online: frame.online,
        messages: frame.messages,
        conversations: frame.conversations,
        commands: frame.commands,
        proposals: frame.proposals,
        error: '',
      };
    case 'presence':
      return { ...state, online: frame.online };
    case 'message':
      return { ...state, messages: upsert(state.messages, frame.message, 200) };
    case 'status':
      return { ...state, conversations: frame.conversations };
    case 'command.state':
      return {
        ...state,
        commands: upsert(
          state.commands,
          { id: frame.commandId, status: frame.status, detail: frame.detail },
          100,
        ),
      };
    case 'proposal':
      return { ...state, proposals: upsert(state.proposals, frame.proposal, 50) };
    case 'proposal.ack':
      if (frame.status === 'stale') return state;
      return { ...state, proposals: state.proposals.filter((proposal) => proposal.id !== frame.id) };
    case 'error':
      return { ...state, error: frame.message };
    default:
      return state;
  }
}

export function canApplyProposal(proposal: DraftProposal, current: PageContext | null) {
  const expected = proposal.context;
  return Boolean(
    current &&
      current.activity !== 'saving' &&
      current.activity !== 'conflict' &&
      current.tabId === expected.tabId &&
      current.pageEpoch === expected.pageEpoch &&
      current.seq === expected.seq &&
      current.productionId === expected.productionId &&
      current.step === expected.step &&
      current.sourceId === expected.sourceId &&
      current.version === expected.version &&
      current.route === expected.route &&
      current.draft &&
      expected.draft &&
      current.draft.revision === expected.draft.revision &&
      current.draft.value === expected.draft.value &&
      current.draft.baseValue === expected.draft.baseValue &&
      JSON.stringify(current.field) === JSON.stringify(expected.field) &&
      JSON.stringify(current.field) === JSON.stringify(proposal.target) &&
      JSON.stringify(current.selection) === JSON.stringify(expected.selection),
  );
}

export function mergeDraft<T extends Record<string, unknown>>(base: T, draft: T, incoming: T) {
  const value = { ...draft };
  const conflicts: (keyof T)[] = [];
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    if (
      key === 'sources' &&
      Array.isArray(base[key]) &&
      Array.isArray(draft[key]) &&
      Array.isArray(incoming[key])
    ) {
      const sources = mergeSources(base[key], draft[key], incoming[key]);
      value[key] = sources.value as T[keyof T];
      if (sources.conflict) conflicts.push(key);
      continue;
    }
    const unchanged = JSON.stringify(draft[key]) === JSON.stringify(base[key]);
    if (unchanged) value[key] = incoming[key];
    else if (
      JSON.stringify(incoming[key]) !== JSON.stringify(base[key]) &&
      JSON.stringify(draft[key]) !== JSON.stringify(incoming[key])
    )
      conflicts.push(key);
  }
  return { value, conflicts };
}

function mergeSources(base: { id: string }[], draft: { id: string }[], incoming: { id: string }[]) {
  let conflict = false;
  const value = draft.flatMap((source) => {
    const before = base.find((item) => item.id === source.id);
    const after = incoming.find((item) => item.id === source.id);
    if (!before) return [source];
    if (!after) {
      if (JSON.stringify(source) === JSON.stringify(before)) return [];
      conflict = true;
      return [source];
    }
    const merged = mergeDraft(before, source, after);
    conflict ||= merged.conflicts.length > 0;
    return [merged.value];
  });
  for (const source of incoming) {
    const before = base.find((item) => item.id === source.id);
    if (!before && !value.some((item) => item.id === source.id)) value.push(source);
    else if (
      before &&
      !draft.some((item) => item.id === source.id) &&
      JSON.stringify(before) !== JSON.stringify(source)
    )
      conflict = true;
  }
  return { value, conflict };
}

export function agentSocketUrl(origin: string, remote: boolean) {
  const url = new URL(remote ? '/admin/remote-api/agent/live' : '/admin/api/agent/live', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('protocol', '1');
  return url.href;
}
