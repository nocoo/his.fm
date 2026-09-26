import { EditorSelection, type EditorState } from '@codemirror/state';

export function wrapSelection(state: EditorState, before: string, after = before) {
  return state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const wrapped =
      range.from >= before.length &&
      state.sliceDoc(range.from - before.length, range.from) === before &&
      state.sliceDoc(range.to, range.to + after.length) === after;
    return {
      changes: wrapped
        ? [
            { from: range.from - before.length, to: range.from, insert: '' },
            { from: range.to, to: range.to + after.length, insert: '' },
          ]
        : { from: range.from, to: range.to, insert: `${before}${selected}${after}` },
      range: EditorSelection.range(
        range.from + (wrapped ? -before.length : before.length),
        range.to + (wrapped ? -before.length : before.length),
      ),
    };
  });
}

export function prefixLines(state: EditorState, prefix: string) {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to > from && state.sliceDoc(to - 1, to) === '\n' ? to - 1 : to);
  const lines = state.sliceDoc(first.from, last.to).split('\n');
  const remove = lines.every((line) => line.startsWith(prefix));
  const insert = lines.map((line) => (remove ? line.slice(prefix.length) : `${prefix}${line}`)).join('\n');
  return {
    changes: { from: first.from, to: last.to, insert },
    selection: EditorSelection.range(first.from, first.from + insert.length),
  };
}
