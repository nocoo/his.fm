import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { categories } from '../../shared/episode';
import type { ProductionBrief } from '../../shared/production';
import { useAgent, useAgentField, useDraft } from '../agent/AgentProvider';
import { DraftConflicts } from '../agent/DraftConflicts';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { Choice, Failure } from './controls';
import { readBrief } from './model';
import { type SourceDraft, SourceEditor, SourceList } from './SourceEditor';

export function BriefForm({
  value,
  pending,
  onSave,
  onDirty,
  onComplete,
  completed = false,
  productionId,
}: {
  value: ProductionBrief;
  pending: boolean;
  onSave: (brief: ProductionBrief) => Promise<void>;
  onComplete?: (brief: ProductionBrief) => Promise<void>;
  completed?: boolean;
  onDirty: (dirty: boolean) => void;
  productionId?: string;
}) {
  const [query, setQuery] = useSearchParams();
  const agent = useAgent();
  const selected = query.get('source');
  const draft = useDraft({
    title: value.title,
    intent: value.intent,
    episodeNumber: value.episodeNumber,
    slug: value.slug,
    category: value.category,
    targetDurationSeconds: value.targetDurationSeconds,
    tags: value.tags.join('，'),
    sources: value.sources,
  });
  const { sources, category } = draft.value;
  const sourceIndex = sources.findIndex((source) => source.id === selected);
  const setSources = (sources: SourceDraft[]) => draft.change('sources', sources);
  const title = useAgentField(
    productionId ? { productionId, field: 'title' } : null,
    draft.value.title,
    value.title,
    (next) => {
      draft.change('title', next);
      onDirty(true);
    },
    pending || draft.conflicts.length > 0,
  );
  const intent = useAgentField(
    productionId ? { productionId, field: 'intent' } : null,
    draft.value.intent,
    value.intent,
    (next) => {
      draft.change('intent', next);
      onDirty(true);
    },
    pending || draft.conflicts.length > 0,
  );
  useEffect(() => {
    onDirty(draft.dirty);
  }, [draft.dirty, onDirty]);
  const [error, setError] = useState('');
  const openSource = (id: string | null) => {
    const next = new URLSearchParams(query);
    if (id === null) next.delete('source');
    else next.set('source', id);
    setQuery(next);
  };
  return (
    <>
      <DraftConflicts fields={draft.conflicts} resolve={draft.resolve} />
      <form
        hidden={selected !== null}
        className="studio-stack studio-brief-overview"
        onChange={() => onDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          const result = readBrief(new FormData(event.currentTarget), sources);
          setError(result.error);
          if (result.data && !draft.conflicts.length) {
            const complete =
              (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'complete';
            if (complete && onComplete) await onComplete(result.data);
            else await onSave(result.data);
          }
        }}
      >
        {error && <Failure error={error} />}
        <fieldset disabled={pending} className="studio-fieldset studio-stack">
          <LayerCard padding="none">
            <LayerCard.Header>
              <strong>这一期想说什么</strong>
            </LayerCard.Header>
            <LayerCard.Body className="studio-stack studio-padding">
              <Field label="节目标题" htmlFor="production-title" required>
                <Input
                  id="production-title"
                  name="title"
                  value={draft.value.title}
                  onFocus={title.onFocus}
                  onChange={(event) => title.onChange(event.target.value)}
                  onSelect={(event) => {
                    const input = event.currentTarget;
                    title.onSelection({
                      from: input.selectionStart ?? 0,
                      to: input.selectionEnd ?? 0,
                      text: input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
                    });
                  }}
                  onCompositionStart={() => title.onComposition(true)}
                  onCompositionEnd={() => title.onComposition(false)}
                  required
                  maxLength={160}
                  placeholder="一个具体、值得讲清楚的问题"
                />
              </Field>
              <Field
                label="创作意图"
                htmlFor="production-intent"
                hint={
                  <>
                    先遵循 <Link to="/admin/channel">全局提示词</Link>
                    ，再明确本期中心思想。素材用来支撑这个问题，而不是替你决定讲什么。
                  </>
                }
              >
                <MarkdownEditor
                  label="创作意图"
                  id="production-intent"
                  name="intent"
                  value={draft.value.intent}
                  onChange={intent.onChange}
                  onSelection={intent.onSelection}
                  onComposition={intent.onComposition}
                  disabled={pending}
                  maxLength={12000}
                  placeholder="为什么想讲这个话题？听众听完应该带走什么？"
                />
              </Field>
              <div className="studio-grid">
                <Field label="期数" htmlFor="production-number" required>
                  <Input
                    id="production-number"
                    name="episodeNumber"
                    onFocus={() => agent?.clearField()}
                    type="number"
                    min={1}
                    max={99999}
                    value={draft.value.episodeNumber}
                    onChange={(event) => draft.change('episodeNumber', Number(event.target.value))}
                    required
                  />
                </Field>
                <Field label="链接名称" htmlFor="production-slug" required hint="小写英文、数字与连字符">
                  <Input
                    id="production-slug"
                    name="slug"
                    onFocus={() => agent?.clearField()}
                    value={draft.value.slug}
                    onChange={(event) => draft.change('slug', event.target.value)}
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={120}
                    placeholder="a-new-perspective"
                  />
                </Field>
              </div>
              <div className="studio-grid">
                <Field label="分类">
                  <Choice
                    name="category"
                    onFocus={() => agent?.clearField()}
                    label="分类"
                    value={category}
                    disabled={pending}
                    onChange={(next) => {
                      draft.change('category', next as ProductionBrief['category']);
                      onDirty(true);
                    }}
                    options={categories.map(({ id, label }) => ({ value: id, label }))}
                  />
                </Field>
                <Field label="目标时长（分钟）" htmlFor="production-duration" required>
                  <Input
                    id="production-duration"
                    name="durationMinutes"
                    onFocus={() => agent?.clearField()}
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    value={draft.value.targetDurationSeconds / 60}
                    onChange={(event) =>
                      draft.change('targetDurationSeconds', Number(event.target.value) * 60)
                    }
                    required
                  />
                </Field>
              </div>
              <Field label="标签" htmlFor="production-tags" hint="使用逗号分隔，最多 10 个。">
                <Input
                  id="production-tags"
                  name="tags"
                  onFocus={() => agent?.clearField()}
                  value={draft.value.tags}
                  onChange={(event) => draft.change('tags', event.target.value)}
                />
              </Field>
            </LayerCard.Body>
          </LayerCard>
          <LayerCard padding="none">
            <LayerCard.Header className="studio-row">
              <strong>原始素材 · {sources.length} / 30</strong>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || sources.length >= 30}
                onClick={() => {
                  const id = crypto.randomUUID();
                  setSources([...sources, { id, type: 'url', title: '', content: '' }]);
                  onDirty(true);
                  openSource(id);
                }}
              >
                <Plus size={14} />
                添加素材
              </Button>
            </LayerCard.Header>
            <LayerCard.Body className="studio-stack studio-padding">
              {!sources.length && (
                <p className="admin-muted">添加文章链接、GitHub 仓库或文本。标记完成前至少需要一份素材。</p>
              )}
              <SourceList sources={sources} disabled={pending} onOpen={openSource} />
            </LayerCard.Body>
          </LayerCard>
          <div className="studio-stage-footer">
            <p className="admin-muted">明确素材与讲述意图，确认后进入逐字稿。随时可以回来调整。</p>
            <div className="studio-actions">
              <Button
                type="submit"
                variant={onComplete ? 'outline' : 'default'}
                loading={pending}
                disabled={draft.conflicts.length > 0}
              >
                保存选题
              </Button>
              {onComplete && (
                <Button
                  type="submit"
                  value="complete"
                  loading={pending}
                  disabled={draft.conflicts.length > 0}
                >
                  {completed ? '确认选题并继续' : '标记选题完成'}
                </Button>
              )}
            </div>
          </div>
        </fieldset>
      </form>
      {selected !== null && (
        <SourceEditor
          key={selected}
          productionId={productionId}
          proposalBlocked={draft.conflicts.length > 0}
          base={value.sources.find((source) => source.id === selected)}
          source={sources[sourceIndex]}
          index={sourceIndex}
          pending={pending}
          onBack={() => openSource(null)}
          onChange={(source) => {
            setSources(sources.map((item, index) => (index === sourceIndex ? source : item)));
            onDirty(true);
          }}
          onRemove={() => {
            setSources(sources.filter((_, index) => index !== sourceIndex));
            onDirty(true);
            openSource(null);
          }}
        />
      )}
    </>
  );
}
