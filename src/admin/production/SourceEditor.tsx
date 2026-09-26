import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { ArrowLeft, ChevronRight, FileText, GitBranch, Link2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type ProductionBrief, sourceSchema } from '../../shared/production';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { Choice, Confirm, Failure } from './controls';

type Source = ProductionBrief['sources'][number];
export type SourceDraft = Source & { key: string };
const sourceTypes = [
  { value: 'url', label: '文章链接', icon: Link2 },
  { value: 'github', label: 'GitHub 仓库', icon: GitBranch },
  { value: 'text', label: '文本素材', icon: FileText },
];

export function SourceList({
  sources,
  disabled,
  onOpen,
}: {
  sources: SourceDraft[];
  disabled: boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <ul className="studio-source-list" aria-label="原始素材">
      {sources.map((source, index) => {
        const { label, icon: Icon } =
          sourceTypes.find((type) => type.value === source.type) ?? sourceTypes[0];
        return (
          <li key={source.key}>
            <Button
              type="button"
              variant="ghost"
              className="studio-source-row"
              disabled={disabled}
              aria-label={`打开素材 ${index + 1}：${source.title || '未命名素材'}`}
              onClick={() => onOpen(index)}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="studio-source-copy">
                <strong>{source.title || `未命名素材 ${index + 1}`}</strong>
                <span className="admin-muted">
                  {label} · {source.content.replace(/\s+/g, ' ').slice(0, 140) || '待填写内容'}
                </span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function SourceEditor({
  source,
  index,
  pending,
  onChange,
  onBack,
  onRemove,
}: {
  source: SourceDraft | undefined;
  index: number;
  pending: boolean;
  onChange: (source: SourceDraft) => void;
  onBack: () => void;
  onRemove: () => void;
}) {
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  return (
    <div className="admin-page studio-source-editor">
      <PageHeader
        title={source?.title || (source ? `素材 ${index + 1}` : '素材不存在')}
        actions={
          <Button variant="ghost" size="sm" disabled={pending} onClick={onBack}>
            <ArrowLeft size={16} />
            返回选题
          </Button>
        }
      />
      {source ? (
        <form
          className="studio-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const { key: _, ...fields } = source;
            if (!sourceSchema.safeParse(fields).success) {
              setError('请填写素材内容，链接须使用 HTTPS；标题最多 200 字，正文最多 80,000 字。');
              return;
            }
            onBack();
          }}
        >
          {error && <Failure error={error} />}
          <fieldset disabled={pending} className="studio-fieldset studio-stack">
            <LayerCard className="studio-stack">
              <div className="studio-source-metadata">
                <Field label="素材类型">
                  <Choice
                    label={`素材 ${index + 1} 类型`}
                    value={source.type}
                    disabled={pending}
                    onChange={(type) => onChange({ ...source, type: type as Source['type'] })}
                    options={sourceTypes}
                  />
                </Field>
                <Field label="素材标题" htmlFor="source-title">
                  <Input
                    id="source-title"
                    value={source.title}
                    maxLength={200}
                    placeholder="便于识别的标题"
                    onChange={(event) => onChange({ ...source, title: event.target.value })}
                  />
                </Field>
              </div>
              <Field
                label={source.type === 'text' ? '素材正文' : 'HTTPS 链接'}
                htmlFor="source-content"
                required
              >
                {source.type === 'text' ? (
                  <MarkdownEditor
                    id="source-content"
                    label="素材正文"
                    value={source.content}
                    maxLength={80000}
                    disabled={pending}
                    onChange={(content) => onChange({ ...source, content })}
                  />
                ) : (
                  <InputArea
                    id="source-content"
                    value={source.content}
                    maxLength={80000}
                    required
                    rows={2}
                    placeholder="https://"
                    onChange={(event) => onChange({ ...source, content: event.target.value })}
                  />
                )}
              </Field>
            </LayerCard>
            <div className="studio-stage-footer">
              <p className="admin-muted">返回会保留输入；素材与其他改动一起通过“保存选题”保存。</p>
              <div className="studio-actions">
                <Button type="button" variant="ghost" onClick={() => setRemoving(true)}>
                  <Trash2 size={16} />
                  移除素材
                </Button>
                <Button type="submit">完成编辑</Button>
              </div>
            </div>
          </fieldset>
        </form>
      ) : (
        <p className="admin-muted">这份素材尚未保存或已被移除，请返回选题查看素材列表。</p>
      )}
      {removing && (
        <Confirm
          title="移除这份素材"
          description="从本期素材列表移除，保存选题后生效。"
          onClose={() => setRemoving(false)}
          onConfirm={async () => onRemove()}
        />
      )}
    </div>
  );
}
