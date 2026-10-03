import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { Button } from '@nocoo/basalt';
import { SegmentControl } from '@nocoo/basalt/components/segment-control';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Search,
  Undo2,
} from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CopyButton } from '../production/controls';
import { ReadingText } from '../production/ReadingText';
import { prefixLines, wrapSelection } from './commands';
import './markdown.css';

const query = '(min-width: 1024px)';
const subscribe = (change: () => void) => {
  const media = matchMedia(query);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
};
const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: 'hsl(var(--basalt-primary))', fontWeight: '600' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: [tags.url, tags.link], color: 'hsl(var(--basalt-primary))' },
    { tag: [tags.processingInstruction, tags.meta], color: 'hsl(var(--basalt-muted-foreground))' },
    { tag: tags.monospace, fontFamily: 'ui-monospace, monospace' },
  ]),
);

export function MarkdownEditor({
  id,
  label,
  value,
  defaultValue = '',
  onChange,
  onSelection,
  onComposition,
  name,
  disabled = false,
  maxLength,
  placeholder = '用 Markdown 写下你的想法……',
  defaultMode = 'edit',
  previewClassName = '',
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  id: string;
  label: string;
  value?: string;
  defaultValue?: string;
  onChange: (value: string) => void;
  onSelection?: (selection: { from: number; to: number; text: string }, composing: boolean) => void;
  onComposition?: (composing: boolean) => void;
  name?: string;
  disabled?: boolean;
  maxLength: number;
  placeholder?: string;
  defaultMode?: 'edit' | 'preview';
  previewClassName?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const [draft, setDraft] = useState(defaultValue);
  const content = value ?? draft;
  const preview = useDeferredValue(content);
  const [mode, setMode] = useState<string>(defaultMode);
  const wide = useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  );
  const display = mode === 'split' && !wide ? 'edit' : mode;
  const editor = useRef<ReactCodeMirrorRef>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const overflow = content.length > maxLength;
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      highlight,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        id,
        'aria-label': label,
        'aria-describedby': [describedBy, `${id}-status`].filter(Boolean).join(' '),
        'aria-invalid': String(invalid || overflow),
        spellcheck: 'false',
      }),
      EditorState.phrases.of({
        Find: '查找',
        Replace: '替换',
        next: '下一个',
        previous: '上一个',
        all: '全部',
        'match case': '区分大小写',
        regexp: '正则表达式',
        'by word': '全词匹配',
        replace: '替换',
        'replace all': '全部替换',
        close: '关闭',
        'No matches': '没有匹配项',
        'Go to line': '跳转到行',
        go: '跳转',
      }),
      keymap.of([
        {
          key: 'Mod-b',
          run: (view) => {
            if (view.state.readOnly) return false;
            view.dispatch(wrapSelection(view.state, '**'));
            return true;
          },
        },
        {
          key: 'Mod-i',
          run: (view) => {
            if (view.state.readOnly) return false;
            view.dispatch(wrapSelection(view.state, '*'));
            return true;
          },
        },
      ]),
      EditorView.scrollHandler.of((view) => {
        view.requestMeasure({
          key: view,
          read: (editor) => {
            if (!editor.dom.getClientRects().length) return null;
            const island = editor.dom.closest('.admin-content-island');
            const cursor = editor.coordsAtPos(editor.state.selection.main.head);
            if (!island || !cursor) return null;
            const bounds = island.getBoundingClientRect();
            const delta =
              cursor.top < bounds.top + 100
                ? cursor.top - bounds.top - 100
                : cursor.bottom > bounds.bottom - 24
                  ? cursor.bottom - bounds.bottom + 24
                  : 0;
            return { island, top: island.scrollTop + delta };
          },
          write: (measurement) => {
            if (measurement) measurement.island.scrollTop = measurement.top;
          },
        });
        return true;
      }),
    ],
    [id, label, overflow, describedBy, invalid],
  );
  const tools = [
    { label: '章节标题', icon: Heading2, run: (state: EditorState) => prefixLines(state, '## ') },
    { label: '加粗', icon: Bold, run: (state: EditorState) => wrapSelection(state, '**') },
    { label: '斜体', icon: Italic, run: (state: EditorState) => wrapSelection(state, '*') },
    { label: '项目列表', icon: List, run: (state: EditorState) => prefixLines(state, '- ') },
    { label: '编号列表', icon: ListOrdered, run: (state: EditorState) => prefixLines(state, '1. ') },
    { label: '引用', icon: Quote, run: (state: EditorState) => prefixLines(state, '> ') },
    { label: '链接', icon: Link, run: (state: EditorState) => wrapSelection(state, '[', '](https://)') },
    { label: '代码', icon: Code, run: (state: EditorState) => wrapSelection(state, '`') },
  ];
  return (
    <fieldset className="markdown-editor" data-mode={display} aria-label={`${label}编辑器`}>
      {name && <input type="hidden" name={name} value={content} disabled={disabled} />}
      <div className="markdown-toolbar">
        <SegmentControl
          legend={<span className="sr-only">{label}显示方式</span>}
          value={display}
          onValueChange={setMode}
          options={[
            { value: 'edit', label: '编辑' },
            { value: 'preview', label: '预览' },
            ...(wide ? [{ value: 'split', label: '分栏' }] : []),
          ]}
        />
        <CopyButton label="复制 Markdown" read={() => content} disabled={!content} />
        {display !== 'preview' && (
          <fieldset className="markdown-tools" aria-label="Markdown 格式工具">
            {tools.map(({ label, icon: Icon, run }) => (
              <Button
                key={label}
                type="button"
                size="icon"
                variant="ghost"
                aria-label={label}
                title={label}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const view = editor.current?.view;
                  if (view) {
                    view.dispatch({ ...run(view.state), scrollIntoView: true, userEvent: 'input' });
                    view.focus();
                  }
                }}
              >
                <Icon size={16} strokeWidth={1.5} />
              </Button>
            ))}
            <span className="markdown-tool-divider" />
            {[
              { label: '撤销', icon: Undo2, run: undo, disabled: !history.undo },
              { label: '重做', icon: Redo2, run: redo, disabled: !history.redo },
              { label: '查找与替换', icon: Search, run: openSearchPanel, disabled: false },
            ].map(({ label, icon: Icon, run, disabled: unavailable }) => (
              <Button
                key={label}
                type="button"
                size="icon"
                variant="ghost"
                aria-label={label}
                title={label}
                disabled={disabled || unavailable}
                onClick={() => {
                  const view = editor.current?.view;
                  if (view) {
                    run(view);
                    if (run !== openSearchPanel) view.focus();
                  }
                }}
              >
                <Icon size={16} strokeWidth={1.5} />
              </Button>
            ))}
          </fieldset>
        )}
      </div>
      <div className="markdown-panes">
        <div
          className="markdown-source"
          hidden={display === 'preview'}
          onCompositionStart={() => onComposition?.(true)}
          onCompositionEnd={() => onComposition?.(false)}
        >
          <CodeMirror
            ref={editor}
            value={content}
            theme="none"
            editable={!disabled}
            readOnly={disabled}
            placeholder={placeholder}
            extensions={extensions}
            indentWithTab={false}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLineGutter: false,
              highlightActiveLine: false,
              autocompletion: false,
              bracketMatching: false,
              closeBrackets: false,
            }}
            onChange={(next) => {
              setDraft(next);
              onChange(next);
            }}
            onUpdate={({ state, view, selectionSet, focusChanged, docChanged }) => {
              if (view.hasFocus && (selectionSet || focusChanged || docChanged)) {
                const { from, to } = state.selection.main;
                onSelection?.({ from, to, text: state.doc.sliceString(from, to) }, view.composing);
              }
              const next = { undo: undoDepth(state) > 0, redo: redoDepth(state) > 0 };
              setHistory((current) =>
                current.undo === next.undo && current.redo === next.redo ? current : next,
              );
            }}
          />
        </div>
        {display !== 'edit' && (
          <section className="markdown-preview" aria-label={`${label}预览`}>
            {preview.trim() ? (
              <ReadingText text={preview} className={previewClassName} />
            ) : (
              <p className="admin-muted">写下内容后，在这里预览排版。</p>
            )}
          </section>
        )}
      </div>
      <div id={`${id}-status`} className={`markdown-status ${overflow ? 'admin-error' : 'admin-muted'}`}>
        <span>
          {content.length.toLocaleString()} / {maxLength.toLocaleString()} 字
          {overflow ? ' · 超出保存上限，请精简内容' : ''}
        </span>
        <span>Markdown · ⌘ / Ctrl B 加粗 · F 查找</span>
      </div>
    </fieldset>
  );
}
