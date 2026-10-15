import { useState } from 'react';
import { mergeDraft } from './model';

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
