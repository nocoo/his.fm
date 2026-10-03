import { Button, LayerCard } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { Confirm, CopyButton, Failure } from '../production/controls';
import { dateLabel } from '../production/model';
import { ReadingText } from '../production/ReadingText';
import { useChannel } from './useChannel';
import './channel.css';

export default function ChannelPage() {
  const vm = useChannel();
  const [confirmation, setConfirmation] = useState<'reload' | 'overwrite' | null>(null);
  return (
    <div className="admin-page channel-page">
      <PageHeader
        title="全局提示词"
        actions={
          <Button
            loading={vm.pending}
            disabled={!vm.dirty || !vm.content.trim() || vm.content.length > 30000 || Boolean(vm.conflict)}
            onClick={() => void vm.save()}
          >
            <Save size={16} />
            保存提示词
          </Button>
        }
      />
      {vm.error && <Failure error={vm.error} retry={!vm.channel ? () => void vm.load() : undefined} />}
      {!vm.channel && !vm.error && <LayerCard.Loading label="正在读取全局提示词" />}
      {vm.channel && (
        <>
          {vm.conflict && (
            <LayerCard className="studio-stack" padding="md">
              <strong>提示词已有新版本 · v{vm.conflict.version}</strong>
              <p className="admin-muted">你的草稿完整保留。先对照已保存的内容，再决定采用哪一版。</p>
              <details>
                <summary>对照最新版本</summary>
                <ReadingText text={vm.conflict.content} />
              </details>
              <div className="studio-actions">
                <CopyButton label="复制我的草稿" read={() => vm.content} />
                <Button variant="outline" onClick={() => setConfirmation('reload')}>
                  采用最新版本
                </Button>
                <Button
                  disabled={vm.pending || !vm.content.trim() || vm.content.length > 30000}
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
              id="global-prompt"
              label="全局提示词正文"
              value={vm.content}
              maxLength={30000}
              onChange={vm.setContent}
              disabled={vm.pending}
            />
          </LayerCard>
          {vm.content.length > 30000 && (
            <Failure error="提示词最多可保存 30,000 个字符，请精简后重试。草稿仍然保留。" />
          )}
          <div className="studio-stage-footer">
            <span className="admin-muted" role="status">
              {vm.dirty ? '有未保存改动' : `已保存 · v${vm.channel.version}`}
            </span>
            <div className="channel-save-detail">
              <p>
                {vm.draftNotice ||
                  (vm.dirty
                    ? '草稿保留在当前标签页，保存后才会用于创作。'
                    : `最近保存于 ${dateLabel(vm.channel.updatedAt)}`)}
              </p>
              <p className="admin-muted">
                Hermes 每次创作先读取全局提示词。改动作用于后续任务，不会自动改写已有节目或撤销确认。
              </p>
            </div>
            <div className="studio-actions">
              <Button
                variant="outline"
                disabled={!vm.dirty || vm.pending}
                onClick={() => setConfirmation('reload')}
              >
                放弃草稿
              </Button>
              <Button
                loading={vm.pending}
                disabled={
                  !vm.dirty || !vm.content.trim() || vm.content.length > 30000 || Boolean(vm.conflict)
                }
                onClick={() => void vm.save()}
              >
                保存全部改动
              </Button>
            </div>
          </div>
          <p className="admin-muted">
            全局提示词是内部的选题与表达标准，不直接进入节目文稿。中心思想与全局提示词冲突时先由你决定；任何观点都不能代替事实核查。
          </p>
        </>
      )}
      {confirmation && vm.channel && (
        <Confirm
          title={confirmation === 'reload' ? '采用已保存的提示词' : '以当前草稿更新全局提示词'}
          description={
            confirmation === 'reload'
              ? '当前未保存草稿将被替换。需要保留的内容请先复制。'
              : '请确认已对照最新内容。本次会用你的完整草稿更新全局提示词，并供后续创作使用。'
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
