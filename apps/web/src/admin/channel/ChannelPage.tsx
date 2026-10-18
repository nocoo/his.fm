import { orderedPromptSlots, type PromptSlotInput, promptSlotInputSchema } from '@his-fm/contracts';
import { Button, Field, Input, LayerCard, Switch } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router';
import { FramedCover } from '../../components/FramedCover';
import { useCategories } from '../categories/useCategories';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { errorMessage } from '../model';
import { Choice, Confirm, CopyButton, Failure } from '../production/controls';
import { ReadingText } from '../production/ReadingText';
import { moveSlot } from './model';
import { promptSlotsService } from './service';
import { usePromptSlots } from './usePromptSlots';
import './channel.css';

export default function ChannelPage() {
  const [params, setParams] = useSearchParams();
  const categories = useCategories();
  const requested = params.get('scope') ?? 'channel';
  const selected = requested.startsWith('category:') ? requested : 'channel';
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const panels = [...new Set([...visited, selected])];
  useEffect(() => {
    setVisited((current) => (current.includes(selected) ? current : [...current, selected]));
  }, [selected]);
  return (
    <div className="admin-page channel-page">
      <PageHeader
        title="提示词"
        actions={
          <div className="channel-header-actions">
            <div className="channel-selector">
              <Choice
                label="提示词范围"
                value={selected}
                options={[
                  { value: 'channel', label: '频道 · 全局' },
                  ...categories.categories.map((category) => ({
                    value: `category:${category.id}`,
                    label: `栏目 · ${category.name}`,
                  })),
                ]}
                onChange={(scope) => {
                  setParams({ scope });
                }}
              />
            </div>
            <div ref={setActionsTarget} className="channel-save-action" />
          </div>
        }
      />
      {categories.error && <Failure error={categories.error} retry={() => void categories.load()} />}
      {panels.map((scope) => (
        <div key={scope} hidden={scope !== selected}>
          <SlotTable
            categoryId={scope === 'channel' ? null : scope.slice(9)}
            active={scope === selected}
            requestedSlot={scope === selected ? params.get('slot') : null}
            onSelect={(slot) => setParams({ scope, slot })}
            actionsTarget={scope === selected ? actionsTarget : null}
          />
        </div>
      ))}
    </div>
  );
}

function SlotTable({
  categoryId,
  active,
  requestedSlot,
  onSelect,
  actionsTarget,
}: {
  categoryId: string | null;
  active: boolean;
  requestedSlot: string | null;
  onSelect: (slot: string) => void;
  actionsTarget: HTMLDivElement | null;
}) {
  const vm = usePromptSlots(categoryId, active);
  const scopeId = categoryId === null ? 'channel' : `category-${categoryId}`;
  const [selectedId, setSelectedId] = useState('');
  const [visited, setVisited] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirmation, setConfirmation] = useState<'reload' | 'overwrite' | 'remove' | 'apply' | null>(null);
  const slots = orderedPromptSlots(vm.slots);
  const selected =
    slots.find((slot) => slot.id === requestedSlot) ??
    slots.find((slot) => slot.id === selectedId) ??
    slots[0];
  const mounted = new Set([...visited, ...(selected ? [selected.id] : [])]);
  const activeSlotId = selected?.id;
  useEffect(() => {
    if (activeSlotId)
      setVisited((current) => (current.includes(activeSlotId) ? current : [...current, activeSlotId]));
  }, [activeSlotId]);
  const patch = (value: Partial<PromptSlotInput>) => {
    if (selected)
      vm.setSlots(vm.slots.map((slot) => (slot.id === selected.id ? { ...slot, ...value } : slot)));
  };
  const choose = (id: string) => {
    setSelectedId(id);
    onSelect(id);
  };
  return (
    <div className="studio-stack">
      {actionsTarget &&
        vm.table?.initialized &&
        createPortal(
          <Button
            loading={vm.pending}
            disabled={!vm.dirty || !vm.valid || Boolean(vm.conflict)}
            onClick={() => void vm.save()}
          >
            <Save size={16} />
            保存全部提示词
          </Button>,
          actionsTarget,
        )}
      <div className="channel-meta">
        <span role="status" className={vm.dirty ? 'channel-unsaved' : 'admin-muted'}>
          {vm.table
            ? vm.table.initialized
              ? vm.dirty
                ? '有未保存改动'
                : `已保存 · v${vm.table.version}`
              : '尚未迁移 · 旧版只读'
            : '正在读取'}
        </span>
        {categoryId === null ? (
          <span className="admin-muted">跨栏目创作依据 · 不改写已有内容</span>
        ) : (
          <Link className="studio-link" to={`/admin/categories/${encodeURIComponent(categoryId)}`}>
            管理栏目元数据
          </Link>
        )}
      </div>
      {vm.error && <Failure error={vm.error} retry={!vm.table ? () => void vm.load() : undefined} />}
      {!vm.table && !vm.error && <LayerCard.Loading label="正在读取提示词槽位" />}
      {vm.table && !vm.table.initialized && (
        <LayerCard className="studio-stack">
          <div className="studio-row">
            <strong>显式迁移旧版提示词</strong>
            <Button variant="outline" loading={vm.pending} onClick={() => void vm.dryRun()}>
              只读迁移预演
            </Button>
          </div>
          <p className="admin-muted">
            预演只读取当前内容；检查拆分结果后，再明确应用。迁移前不能编辑槽位，旧版内容仍可只读查看。
          </p>
          {vm.preview && (
            <>
              <p className="admin-muted">
                集合 v{vm.preview.version} · 旧版 v{vm.preview.legacyVersion} · {vm.preview.slots.length}{' '}
                个槽位
              </p>
              {vm.preview.unmappedHeadings.length > 0 && (
                <Failure error={`未匹配标题：${vm.preview.unmappedHeadings.join('、')}。请检查预演内容。`} />
              )}
              <section aria-label="迁移预演结果" className="studio-stack">
                {orderedPromptSlots(vm.preview.slots).map((slot) => (
                  <details key={slot.id}>
                    <summary>
                      {slot.title} · {slot.id}
                    </summary>
                    <ReadingText text={slot.body} />
                  </details>
                ))}
              </section>
              <Button
                disabled={vm.pending || vm.preview.initialized}
                onClick={() => setConfirmation('apply')}
              >
                应用已检查的迁移
              </Button>
              {vm.preview.initialized && (
                <Button variant="outline" onClick={() => void vm.load()}>
                  读取已迁移的槽位
                </Button>
              )}
            </>
          )}
        </LayerCard>
      )}
      {vm.conflict && (
        <LayerCard className="studio-stack">
          <strong>提示词槽位已有新版本 · v{vm.conflict.version}</strong>
          <p className="admin-muted">
            全部草稿已保留。保存会整体替换此范围的槽位、启用状态与排序，请先对照。
          </p>
          <details>
            <summary>对照最新集合</summary>
            {orderedPromptSlots(vm.conflict.slots).map((slot) => (
              <div key={slot.id}>
                <strong>
                  {slot.title} · {slot.id} · {slot.enabled ? '启用' : '停用'} ·{' '}
                  {slot.mode === 'append' ? '追加' : '覆盖'}
                </strong>
                <ReadingText text={slot.body} />
              </div>
            ))}
          </details>
          <div className="studio-actions">
            <CopyButton label="复制全部草稿 JSON" read={() => JSON.stringify(vm.slots, null, 2)} />
            <Button variant="outline" onClick={() => setConfirmation('reload')}>
              采用最新集合
            </Button>
            <Button
              disabled={vm.pending || !vm.valid || !vm.conflict.initialized}
              onClick={() => setConfirmation('overwrite')}
            >
              用我的全部草稿更新
            </Button>
          </div>
        </LayerCard>
      )}
      {vm.table?.initialized && (
        <>
          <div className="channel-slot-toolbar">
            <div className="channel-slot-selector">
              {selected && (
                <Choice
                  label="提示词槽位"
                  value={selected.id}
                  disabled={vm.pending}
                  options={slots.map((slot) => ({
                    value: slot.id,
                    label: `${slot.title || slot.id}${slot.enabled ? '' : '（停用）'}`,
                  }))}
                  onChange={choose}
                />
              )}
            </div>
            <div className="studio-actions">
              <Button
                variant="ghost"
                size="icon"
                aria-label="上移槽位"
                disabled={vm.pending || !selected || slots[0]?.id === selected.id}
                onClick={() => selected && vm.setSlots(moveSlot(vm.slots, selected.id, -1))}
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="下移槽位"
                disabled={vm.pending || !selected || slots.at(-1)?.id === selected.id}
                onClick={() => selected && vm.setSlots(moveSlot(vm.slots, selected.id, 1))}
              >
                <ArrowDown size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="删除槽位"
                disabled={vm.pending || !selected}
                onClick={() => setConfirmation('remove')}
              >
                <Trash2 size={16} />
              </Button>
              <Button
                variant="outline"
                disabled={vm.pending || slots.length >= 64}
                onClick={() => setAdding(!adding)}
              >
                <Plus size={16} />
                新增槽位
              </Button>
            </div>
          </div>
          {adding && (
            <NewSlot
              idPrefix={scopeId}
              disabled={vm.pending}
              existing={slots}
              onCancel={() => setAdding(false)}
              onAdd={(slot) => {
                vm.setSlots([...slots, slot].map((entry, order) => ({ ...entry, order })));
                setAdding(false);
                choose(slot.id);
              }}
            />
          )}
          {!slots.length && (
            <LayerCard.Empty
              title="还没有提示词槽位"
              description="添加所需角色，ID 可自由定义；最后一个槽位也可以删除。所有改动在保存全部提示词后生效。"
            />
          )}
          {selected && (
            <>
              <div className="channel-slot-fields">
                <Field label="槽位标题" htmlFor={`slot-title-${scopeId}`} required>
                  <Input
                    id={`slot-title-${scopeId}`}
                    value={selected.title}
                    maxLength={120}
                    disabled={vm.pending}
                    onChange={(event) => patch({ title: event.target.value })}
                  />
                </Field>
                <div className="channel-slot-id admin-muted">ID：{selected.id}</div>
                <Field label="启用槽位" htmlFor={`slot-enabled-${scopeId}`}>
                  <Switch
                    id={`slot-enabled-${scopeId}`}
                    checked={selected.enabled}
                    disabled={vm.pending}
                    onCheckedChange={(enabled) => patch({ enabled })}
                  />
                </Field>
                <Field label="同名槽位策略">
                  <Choice
                    label="同名槽位策略"
                    value={selected.mode}
                    disabled={vm.pending}
                    options={[
                      { value: 'override', label: '覆盖频道同 ID 槽位' },
                      { value: 'append', label: '追加到频道同 ID 槽位' },
                    ]}
                    onChange={(mode) => patch({ mode: mode as PromptSlotInput['mode'] })}
                  />
                </Field>
              </div>
              <p className="admin-muted channel-help">
                {categoryId === null
                  ? '频道槽位提供跨栏目的基础要求；策略在同 ID 栏目槽位上决定如何合并。'
                  : '仅启用的栏目槽位参与合并；停用不会屏蔽频道同 ID 槽位。'}
                {selected.id === 'skills' ? ' skills 只能逐行填写技能名称，不填写指令。' : ''}
              </p>
              {selected.id === 'cover' && (
                <LayerCard className="channel-cover-specimen">
                  <p className="admin-muted">
                    上传与存储的是无框原图；公开预览与下载成品叠加当前主题的品牌框。
                  </p>
                  <FramedCover
                    className="studio-cover"
                    src="/images/episode-01.webp"
                    title="一些声音，一点陪伴。"
                    categoryName="封面排版示例"
                    alt="品牌框叠加示意，非发布节目"
                  />
                </LayerCard>
              )}
            </>
          )}
          <div key={vm.resetKey}>
            {slots
              .filter((slot) => mounted.has(slot.id))
              .map((slot) => (
                <div key={slot.id} hidden={slot.id !== selected?.id}>
                  <LayerCard padding="none" className="channel-sheet">
                    <MarkdownEditor
                      id={`slot-body-${scopeId}-${slot.id}`}
                      label={`槽位正文 · ${slot.id}`}
                      value={slot.body}
                      maxLength={120000}
                      disabled={vm.pending}
                      onChange={(body) =>
                        vm.setSlots((current) =>
                          current.map((entry) => (entry.id === slot.id ? { ...entry, body } : entry)),
                        )
                      }
                    />
                  </LayerCard>
                </div>
              ))}
          </div>
          {!vm.valid && <Failure error={vm.validationError} />}
          <div className="channel-footer">
            <p className="admin-muted">
              {vm.notice || '新增、删除、启停与排序均为草稿，点击「保存全部提示词」后一起生效。'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={!vm.dirty || vm.pending}
              onClick={() => setConfirmation('reload')}
            >
              放弃全部草稿
            </Button>
          </div>
        </>
      )}
      {vm.table && <LegacyPrompts key={vm.table.version} categoryId={categoryId} />}
      <details className="channel-help admin-muted">
        <summary>提示词的生效范围</summary>
        <p>
          创作依据依次为频道、栏目、本期创作意图和素材。提示词不授予权限，不改写事实；保存不重写已有内容，也不改变人工审批。
        </p>
      </details>
      {confirmation && (
        <Confirm
          title={
            {
              reload: '采用已保存的槽位集合',
              overwrite: '以全部草稿更新集合',
              remove: '从草稿删除槽位',
              apply: '确认应用提示词迁移',
            }[confirmation]
          }
          description={
            {
              reload: '全部未保存改动将被替换，需要保留的内容请先复制。',
              overwrite: '此范围的全部槽位将被当前草稿替换，包含删除、启停与排序。请确认已经对照最新集合。',
              remove: `删除「${selected?.title ?? ''}」仅更新本地草稿，保存全部提示词后生效。`,
              apply: '将按已检查的预演拆分当前旧版内容并保存备份，不会自动改写已有节目。',
            }[confirmation]
          }
          onClose={() => setConfirmation(null)}
          onConfirm={async () => {
            if (confirmation === 'apply') return vm.apply();
            if (confirmation === 'overwrite') return vm.save(vm.conflict?.version);
            if (confirmation === 'reload' && vm.table) vm.replace(vm.conflict ?? vm.table);
            if (confirmation === 'remove' && selected)
              vm.setSlots(vm.slots.filter((slot) => slot.id !== selected.id));
            return true;
          }}
        />
      )}
    </div>
  );
}

function NewSlot({
  idPrefix,
  disabled,
  existing,
  onAdd,
  onCancel,
}: {
  idPrefix: string;
  disabled: boolean;
  existing: PromptSlotInput[];
  onAdd: (slot: PromptSlotInput) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const input = { id, title, body: '', order: existing.length, enabled: true, mode: 'override' as const };
  const duplicate = existing.some((slot) => slot.id === id);
  return (
    <LayerCard className="studio-stack">
      <div className="channel-new-fields">
        <Field label="新槽位 ID" htmlFor={`${idPrefix}-new-slot-id`} required>
          <Input
            id={`${idPrefix}-new-slot-id`}
            value={id}
            disabled={disabled}
            maxLength={80}
            onChange={(event) => setId(event.target.value)}
            placeholder="如 editor 或 custom-role"
          />
        </Field>
        <Field label="新槽位标题" htmlFor={`${idPrefix}-new-slot-title`} required>
          <Input
            id={`${idPrefix}-new-slot-title`}
            value={title}
            disabled={disabled}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
      </div>
      <p className="admin-muted">
        ID 使用小写英文、数字与连字符，加入后固定；同 ID 用于频道与栏目合并。
        {duplicate ? '此 ID 已存在。' : ''}
      </p>
      <div className="studio-actions">
        <Button variant="outline" disabled={disabled} onClick={onCancel}>
          取消新增
        </Button>
        <Button
          disabled={disabled || duplicate || !promptSlotInputSchema.safeParse(input).success}
          onClick={() => onAdd({ ...input, title: title.trim() })}
        >
          加入草稿
        </Button>
      </div>
    </LayerCard>
  );
}

function LegacyPrompts({ categoryId }: { categoryId: string | null }) {
  const [content, setContent] = useState<{ title: string; body: string }[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <details className="channel-help">
      <summary>旧版整段提示词（只读）</summary>
      <div className="studio-stack">
        <p className="admin-muted">
          旧字段已停用编辑；迁移后按启用槽位顺序合成供旧客户端读取。请在槽位中维护内容。
        </p>
        <Button
          variant="outline"
          size="sm"
          loading={pending}
          onClick={async () => {
            setPending(true);
            setError('');
            try {
              setContent(await promptSlotsService.legacy(categoryId));
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setPending(false);
            }
          }}
        >
          读取旧版只读内容
        </Button>
        {error && <Failure error={error} />}
        {content?.map((entry) => (
          <details key={entry.title}>
            <summary>{entry.title}</summary>
            <ReadingText text={entry.body} />
          </details>
        ))}
      </div>
    </details>
  );
}
