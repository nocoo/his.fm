import { Button, LayerCard } from '@nocoo/basalt';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Undo2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const editorOptions = {
  extensions: [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      underline: false,
      link: { openOnClick: false, autolink: false, protocols: ['https'] },
    }),
    Markdown,
    Placeholder.configure({ placeholder: '从我们在对谁说话、为什么做这个频道开始……' }),
  ],
  contentType: 'markdown' as const,
  immediatelyRender: true,
  editorProps: {
    attributes: {
      class: 'studio-reader channel-document',
      role: 'textbox',
      'aria-label': '频道定位正文',
      'aria-multiline': 'true',
      spellcheck: 'false',
    },
  },
};

export function ChannelEditor({
  initialContent,
  onChange,
  disabled,
}: {
  initialContent: string;
  onChange: (content: string) => void;
  disabled: boolean;
}) {
  const [initial] = useState(initialContent);
  const editor = useEditor({
    ...editorOptions,
    content: initial,
    onUpdate: ({ editor }) => onChange(editor.getMarkdown().trim()),
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) return null;
      const headings: { title: string; pos: number; level: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading')
          headings.push({ title: node.textContent, pos, level: node.attrs.level });
      });
      return {
        headings,
        characters: Array.from(editor.getText()).length,
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        paragraph: editor.isActive('paragraph'),
        h2: editor.isActive('heading', { level: 2 }),
        h3: editor.isActive('heading', { level: 3 }),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        blockquote: editor.isActive('blockquote'),
        undo: editor.can().undo(),
        redo: editor.can().redo(),
      };
    },
  });
  if (!editor || !state) return <LayerCard.Loading label="正在打开定位编辑器" />;
  const tools = [
    {
      label: '正文',
      icon: Pilcrow,
      active: state.paragraph,
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: '章节标题',
      icon: Heading2,
      active: state.h2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: '小标题',
      icon: Heading3,
      active: state.h3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    { label: '加粗', icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    {
      label: '斜体',
      icon: Italic,
      active: state.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: '项目列表',
      icon: List,
      active: state.bulletList,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: '编号列表',
      icon: ListOrdered,
      active: state.orderedList,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: '引用',
      icon: Quote,
      active: state.blockquote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ];
  return (
    <div className="channel-composer">
      <fieldset className="channel-tools" aria-label="定位编辑工具">
        {tools.map(({ label, icon: Icon, active, run }) => (
          <Button
            key={label}
            size="icon"
            variant={active ? 'secondary' : 'ghost'}
            aria-label={label}
            title={label}
            aria-pressed={active}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
          >
            <Icon size={17} strokeWidth={1.5} />
          </Button>
        ))}
        <span className="channel-tool-separator" />
        <Button
          size="icon"
          variant="ghost"
          aria-label="撤销"
          title="撤销 · ⌘ / Ctrl Z"
          disabled={disabled || !state.undo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={17} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="重做"
          title="重做 · ⌘ / Ctrl Shift Z"
          disabled={disabled || !state.redo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={17} />
        </Button>
      </fieldset>
      <div className="channel-writing-layout">
        <aside className="channel-outline" aria-label="文档目录">
          <span className="admin-muted">文档目录</span>
          {state.headings.length ? (
            state.headings.map(({ title, pos, level }) => (
              <Button
                key={pos}
                variant="ghost"
                size="sm"
                className={level === 3 ? 'channel-subheading' : ''}
                disabled={disabled}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(pos + 1)
                    .scrollIntoView()
                    .run()
                }
              >
                {title || '未命名章节'}
              </Button>
            ))
          ) : (
            <p className="admin-muted">用章节标题整理想法。</p>
          )}
        </aside>
        <EditorContent editor={editor} className="channel-editor-content" />
      </div>
      <div className="channel-editor-foot admin-muted">
        <span>{state.characters.toLocaleString()} 字</span>
        <span>支持 Markdown 快捷输入 · ⌘ / Ctrl S 保存</span>
      </div>
    </div>
  );
}
