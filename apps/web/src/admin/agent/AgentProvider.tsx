import type { DraftProposal, FieldRef, PageContext } from '@his-fm/contracts';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation } from 'react-router';
import { getEnvironment } from '../environment';
import { agentSocketUrl, mergeDraft } from './model';
import { AgentClient } from './service';

const AgentContext = createContext<AgentClient | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new AgentClient(
        agentSocketUrl(window.location.origin, import.meta.env.DEV && getEnvironment() === 'production'),
      ),
  );
  const location = useLocation();
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) client.start();
    });
    return () => {
      active = false;
      client.stop();
    };
  }, [client]);
  useLayoutEffect(() => {
    if (/^\/admin\/productions\/(?!new$)[^/]+$/.test(location.pathname)) return;
    client.setPage({
      route: location.pathname,
      productionId: null,
      step: null,
      sourceId: null,
      version: null,
      activity: 'viewing',
    });
  }, [client, location.pathname]);
  return <AgentContext.Provider value={client}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  return useContext(AgentContext);
}
export function useAgentState(client: AgentClient) {
  return useSyncExternalStore(client.subscribe, client.snapshot);
}

export function useDraft<T extends Record<string, unknown>>(incoming: T) {
  const [state, setState] = useState({ base: incoming, value: incoming, conflicts: [] as (keyof T)[] });
  let current = state;
  if (JSON.stringify(incoming) !== JSON.stringify(state.base)) {
    const merged = mergeDraft(state.base, state.value, incoming);
    current = {
      base: incoming,
      value: merged.value,
      conflicts: [...new Set([...state.conflicts, ...merged.conflicts])].filter(
        (key) => JSON.stringify(merged.value[key]) !== JSON.stringify(incoming[key]),
      ),
    };
    setState(current);
  }
  return {
    ...current,
    dirty: JSON.stringify(current.value) !== JSON.stringify(incoming),
    change: <Key extends keyof T>(key: Key, value: T[Key]) =>
      setState((state) => ({ ...state, value: { ...state.value, [key]: value } })),
    resolve: (keep: boolean) =>
      setState((state) => ({
        ...state,
        value: keep
          ? state.value
          : { ...state.value, ...Object.fromEntries(state.conflicts.map((key) => [key, state.base[key]])) },
        conflicts: [],
      })),
  };
}

export function useAgentField(
  field: FieldRef | null,
  value: string,
  baseValue: string,
  onChange: (value: string) => void,
  disabled = false,
) {
  const client = useAgent();
  const current = useRef({ field, value, baseValue, onChange, disabled });
  current.current = { field, value, baseValue, onChange, disabled };
  const revision = useRef(0);
  const composing = useRef(false);
  const selection = useRef<PageContext['selection']>(null);
  const active = useRef(false);
  const published = useRef('');
  const publish = (focus = false) => {
    const state = current.current;
    if (!active.current || !state.field || !client) return;
    if (!focus && JSON.stringify(client.context?.field) !== JSON.stringify(state.field)) return;
    const signature = JSON.stringify([
      state.field,
      state.value,
      state.baseValue,
      selection.current,
      revision.current,
      client.context?.pageEpoch,
    ]);
    if (
      published.current === signature &&
      JSON.stringify(client.context?.field) === JSON.stringify(state.field)
    )
      return;
    published.current = signature;
    client.field(
      {
        field: state.field,
        draft: { revision: revision.current, value: state.value, baseValue: state.baseValue },
        selection: selection.current,
      },
      (proposal: DraftProposal) => {
        if (current.current.disabled || composing.current) return false;
        change(proposal.value);
        return true;
      },
    );
  };
  const change = (next: string) => {
    revision.current += 1;
    current.current.value = next;
    selection.current = null;
    current.current.onChange(next);
    publish();
  };
  const publishRef = useRef(publish);
  publishRef.current = publish;
  useEffect(() => {
    publishRef.current();
  });
  return {
    onChange: change,
    onFocus: () => {
      active.current = true;
      publish(true);
    },
    onSelection: (next: PageContext['selection'], isComposing = false) => {
      if (isComposing) composing.current = true;
      active.current = true;
      selection.current = next;
      publish(true);
    },
    onComposition: (isComposing: boolean) => {
      composing.current = isComposing;
    },
  };
}
