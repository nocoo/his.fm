import { type PromptKey, promptLabels, promptLimit } from '@his-fm/contracts';
import { Button, LayerCard } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { CategoryEditor } from '../categories/CategoryPage';
import { useCategories } from '../categories/useCategories';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { Choice, Confirm, CopyButton, Failure } from '../production/controls';
import { dateLabel } from '../production/model';
import { ReadingText } from '../production/ReadingText';
import { useChannel } from './useChannel';
import './channel.css';

export default function ChannelPage() {
  const [params, setParams] = useSearchParams();
  const categories = useCategories();
  const options = [
    { value: 'content', label: '全局创作原则', group: '创作依据' },
    ...Object.entries(promptLabels).map(([value, label]) => ({
      value,
      label,
      group: ['editorial', 'boundary', 'brief', 'script', 'cover', 'description'].includes(value)
        ? '内容制作'
        : ['speech', 'voiceComparison', 'narration'].includes(value)
          ? '声音制作'
          : '外部工作流程',
    })),
    ...categories.categories.map((category) => ({
      value: `category:${category.id}`,
      label: `栏目 · ${category.name}`,
      group: '栏目风格',
    })),
  ];
  const requested = params.get('prompt') ?? 'content';
  const selected =
    requested.startsWith('category:') || options.some((option) => option.value === requested)
      ? requested
      : 'content';
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const panels = [...new Set([...visited, selected])];
  return (
    <div className="admin-page channel-page">
      <PageHeader
        title="提示词"
        actions={
          <div className="channel-header-actions">
            <div className="channel-selector">
              <Choice
                label="提示词环节"
                value={selected}
                options={options}
                onChange={(value) => {
                  setVisited(panels);
                  setParams({ prompt: value });
                }}
              />
            </div>
            <div ref={setActionsTarget} className="channel-save-action" />
          </div>
        }
      />

      {categories.error && <Failure error={categories.error} retry={() => void categories.load()} />}
      {panels.map((key) => (
        <div key={key} hidden={key !== selected}>
          {key.startsWith('category:') ? (
            <CategoryEditor
              id={key.slice(9)}
              promptOnly
              actionsTarget={key === selected ? actionsTarget : null}
            />
          ) : (
            <PromptEditor
              promptKey={key as 'content' | PromptKey}
              active={key === selected}
              actionsTarget={key === selected ? actionsTarget : null}
            />
          )}
        </div>
      ))}
    </div>
  );
}
function PromptEditor({
  promptKey,
  active,
  actionsTarget,
}: {
  promptKey: 'content' | PromptKey;
  active: boolean;
  actionsTarget: HTMLDivElement | null;
}) {
  const vm = useChannel(promptKey, active);
  const label = promptKey === 'content' ? '全局提示词正文' : promptLabels[promptKey];
  const limit = promptLimit(promptKey);
  const [confirmation, setConfirmation] = useState<'reload' | 'overwrite' | null>(null);
  return (
    <div className="studio-stack">
      {actionsTarget &&
        createPortal(
          <Button
            loading={vm.pending}
            disabled={!vm.dirty || !vm.content.trim() || vm.content.length > limit || Boolean(vm.conflict)}
            onClick={() => void vm.save()}
          >
            <Save size={16} />
            保存提示词
          </Button>,
          actionsTarget,
        )}
      <div className="channel-meta">
        <span role="status" className={vm.dirty ? 'channel-unsaved' : 'admin-muted'}>
          {vm.channel ? (vm.dirty ? '有未保存改动' : `已保存 · v${vm.channel.version}`) : '正在读取'}
        </span>
        <span className="admin-muted">供外部创作使用 · 不改写已有内容</span>
      </div>
      {vm.error && <Failure error={vm.error} retry={!vm.channel ? () => void vm.load() : undefined} />}
      {!vm.channel && !vm.error && <LayerCard.Loading label="正在读取提示词" />}
      {vm.channel && (
        <>
          {vm.conflict && (
            <LayerCard className="studio-stack" padding="md">
              <strong>提示词已有新版本 · v{vm.conflict.version}</strong>
              <p className="admin-muted">你的草稿完整保留。先对照已保存的内容，再决定采用哪一版。</p>
              <details>
                <summary>对照最新版本</summary>
                <ReadingText text={vm.conflictContent} />
              </details>
              <div className="studio-actions">
                <CopyButton label="复制我的草稿" read={() => vm.content} />
                <Button variant="outline" onClick={() => setConfirmation('reload')}>
                  采用最新版本
                </Button>
                <Button
                  disabled={vm.pending || !vm.content.trim() || vm.content.length > limit}
                  onClick={() => setConfirmation('overwrite')}
                >
                  用我的草稿更新
                </Button>
              </div>
            </LayerCard>
          )}
          <LayerCard padding="none" className="channel-sheet">
            <MarkdownEditor
              key={vm.resetKey}
              id={promptKey === 'content' ? 'global-prompt' : `prompt-${promptKey}`}
              label={label}
              value={vm.content}
              maxLength={limit}
              onChange={vm.setContent}
              disabled={vm.pending}
            />
          </LayerCard>
          {vm.content.length > limit && (
            <Failure
              error={`提示词最多可保存 ${limit.toLocaleString()} 个字符，请精简后重试。草稿仍然保留。`}
            />
          )}
          <div className="channel-footer">
            <p className="admin-muted">
              {vm.draftNotice ||
                (vm.dirty
                  ? '草稿保留在当前标签页，保存后生效。'
                  : `最近保存于 ${dateLabel(vm.channel.updatedAt)}`)}
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={!vm.dirty || vm.pending}
              onClick={() => setConfirmation('reload')}
            >
              放弃草稿
            </Button>
          </div>
          <details className="channel-help admin-muted">
            <summary>提示词的生效范围</summary>
            <p>
              提示词是外部创作的内部工作要求，不直接进入公开成品；保存提示词不会重写已有内容，授权与人工审批仍由服务端控制。
            </p>
          </details>
        </>
      )}
      {confirmation && vm.channel && (
        <Confirm
          title={confirmation === 'reload' ? '采用已保存的提示词' : '以当前草稿更新提示词'}
          description={
            confirmation === 'reload'
              ? '当前未保存草稿将被替换。需要保留的内容请先复制。'
              : '请确认已对照最新内容。本次会用你的完整草稿更新当前提示词，并供后续创作使用。'
          }
          onClose={() => setConfirmation(null)}
          onConfirm={async () => {
            if (!vm.channel) return;
            if (confirmation === 'reload') vm.replaceWithSaved(vm.conflict ?? vm.channel);
            else await vm.save(vm.conflict?.version);
          }}
        />
      )}
    </div>
  );
}
