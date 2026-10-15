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
