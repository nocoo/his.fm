import { EditorSelection, EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { prefixLines, wrapSelection } from './commands';

it('formats Chinese selections without rewriting surrounding Markdown and toggles markers off', () => {
  const doc = '## 提示词\n\n留下细节  \n\n| A | B |\n|---|---|\n| 1 | 2 |';
  let state = EditorState.create({ doc, selection: { anchor: 8, head: 12 } });
  state = state.update(wrapSelection(state, '**')).state;
  expect(state.doc.toString()).toBe(doc.replace('留下细节', '**留下细节**'));
  expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('留下细节');
  state = state.update(wrapSelection(state, '**')).state;
  expect(state.doc.toString()).toBe(doc);
  state = state.update({ selection: EditorSelection.cursor(doc.length) }).state;
  state = state.update(wrapSelection(state, '[', '](https://)')).state;
  expect(state.doc.toString()).toBe(`${doc}[](https://)`);
  expect(state.selection.main.empty).toBe(true);
});

it('prefixes only selected lines, preserving a following unselected paragraph', () => {
  let state = EditorState.create({ doc: '第一条\n第二条\n后记', selection: { anchor: 1, head: 8 } });
  state = state.update(prefixLines(state, '- ')).state;
  expect(state.doc.toString()).toBe('- 第一条\n- 第二条\n后记');
  state = state.update(prefixLines(state, '- ')).state;
  expect(state.doc.toString()).toBe('第一条\n第二条\n后记');
  state = state.update({ selection: EditorSelection.cursor(state.doc.length) }).state;
  state = state.update(prefixLines(state, '## ')).state;
  expect(state.doc.toString()).toBe('第一条\n第二条\n## 后记');
});
