import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { mentionsSchema } from '../../shared/mentions';
import type { ProductionBrief } from '../../shared/production';
import { CategorySelect } from '../categories/CategorySelect';
import { DraftConflicts } from '../draft/DraftConflicts';
import { useDraft } from '../draft/useDraft';
import { MentionsEditor } from '../MentionsEditor';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { Failure } from './controls';
import { readBrief } from './model';
import { type SourceDraft, SourceEditor, SourceList } from './SourceEditor';

export function BriefForm({
  value,
  pending,
  onSave,
  onDirty,
  onComplete,
  completed = false,
  suggestEpisodeNumber,
}: {
  value: ProductionBrief;
  pending: boolean;
  onSave: (brief: ProductionBrief) => Promise<void>;
  onComplete?: (brief: ProductionBrief) => Promise<void>;
  completed?: boolean;
  onDirty: (dirty: boolean) => void;
  suggestEpisodeNumber?: (category: string) => number;
}) {
  const [query, setQuery] = useSearchParams();
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
    mentions: value.mentions,
  });
  const { sources, category } = draft.value;
  const previousCategory = useRef(category);
  const sourceIndex = sources.findIndex((source) => source.id === selected);
  useEffect(() => {
    if (!suggestEpisodeNumber || previousCategory.current === category) return;
    previousCategory.current = category;
    draft.change('episodeNumber', suggestEpisodeNumber(category));
  }, [category, suggestEpisodeNumber, draft]);
  const setSources = (sources: SourceDraft[]) => draft.change('sources', sources);
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
            const mentions = mentionsSchema.parse(
              draft.value.mentions
                .filter((mention) => mention.name.trim() || mention.description.trim() || mention.url)
                .map((mention) => ({
                  name: mention.name.trim(),
                  description: mention.description.trim(),
                  ...(mention.url?.trim() ? { url: mention.url.trim() } : {}),
                })),
            );
            const brief = { ...result.data, mentions };
            const complete =
              (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'complete';
            if (complete && onComplete) await onComplete(brief);
            else await onSave(brief);
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
                  onChange={(event) => draft.change('title', event.target.value)}
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
                  onChange={(next) => draft.change('intent', next)}
                  disabled={pending}
                  maxLength={12000}
                  placeholder="为什么想讲这个话题？听众听完应该带走什么？"
                />
              </Field>
              <div className="studio-grid">
                <Field
                  label="期数"
                  htmlFor="production-number"
                  required
                  hint="栏目内独立编号；切换栏目时会建议下一期，也可手动指定。"
                >
                  <Input
                    id="production-number"
                    name="episodeNumber"
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
                <Field label="栏目">
                  <CategorySelect
                    value={category}
                    disabled={pending}
                    onChange={(next) => {
                      draft.change('category', next as ProductionBrief['category']);
                      onDirty(true);
                    }}
                  />
                </Field>
                <Field label="目标时长（分钟）" htmlFor="production-duration" required>
                  <Input
                    id="production-duration"
                    name="durationMinutes"
                    type="number"
                    min={1}
                    max={60}
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
                  value={draft.value.tags}
                  onChange={(event) => draft.change('tags', event.target.value)}
                />
              </Field>
            </LayerCard.Body>
          </LayerCard>
          <MentionsEditor
            value={draft.value.mentions}
            disabled={pending}
            onChange={(mentions) => {
              draft.change('mentions', mentions);
              onDirty(true);
            }}
          />
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
            <p className="admin-muted">保存资料与素材；确认选题后才可批准逐字稿。</p>
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
                  disabled={draft.conflicts.length > 0 || (completed && !draft.dirty)}
                >
                  {completed && !draft.dirty ? '选题已确认' : '标记选题完成'}
                </Button>
              )}
            </div>
          </div>
        </fieldset>
      </form>
      {selected !== null && (
        <SourceEditor
          key={selected}
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
