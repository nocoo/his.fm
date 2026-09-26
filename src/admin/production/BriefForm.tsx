import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { categories } from '../../shared/episode';
import type { ProductionBrief } from '../../shared/production';
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
}: {
  value: ProductionBrief;
  pending: boolean;
  onSave: (brief: ProductionBrief) => Promise<void>;
  onComplete?: (brief: ProductionBrief) => Promise<void>;
  completed?: boolean;
  onDirty: () => void;
}) {
  const [query, setQuery] = useSearchParams();
  const selected = query.get('source');
  const sourceIndex = selected === null ? -1 : Number(selected) - 1;
  const [sources, setSources] = useState<SourceDraft[]>(() =>
    value.sources.map((source) => ({ ...source, key: crypto.randomUUID() })),
  );
  const [category, setCategory] = useState(value.category);
  const [error, setError] = useState('');
  const openSource = (index: number | null) => {
    const next = new URLSearchParams(query);
    if (index === null) next.delete('source');
    else next.set('source', String(index + 1));
    setQuery(next);
  };
  return (
    <>
      <form
        hidden={selected !== null}
        className="studio-stack studio-brief-overview"
        onChange={onDirty}
        onSubmit={async (event) => {
          event.preventDefault();
          const result = readBrief(
            new FormData(event.currentTarget),
            sources.map(({ key: _, ...source }) => source),
          );
          setError(result.error);
          if (result.data) {
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
                  defaultValue={value.title}
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
                  defaultValue={value.intent}
                  onChange={onDirty}
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
                    type="number"
                    min={1}
                    max={99999}
                    defaultValue={value.episodeNumber}
                    required
                  />
                </Field>
                <Field label="链接名称" htmlFor="production-slug" required hint="小写英文、数字与连字符">
                  <Input
                    id="production-slug"
                    name="slug"
                    defaultValue={value.slug}
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
                    label="分类"
                    value={category}
                    disabled={pending}
                    onChange={(next) => {
                      setCategory(next as ProductionBrief['category']);
                      onDirty();
                    }}
                    options={categories.map(({ id, label }) => ({ value: id, label }))}
                  />
                </Field>
                <Field label="目标时长（分钟）" htmlFor="production-duration" required>
                  <Input
                    id="production-duration"
                    name="durationMinutes"
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    defaultValue={value.targetDurationSeconds / 60}
                    required
                  />
                </Field>
              </div>
              <Field label="标签" htmlFor="production-tags" hint="使用逗号分隔，最多 10 个。">
                <Input id="production-tags" name="tags" defaultValue={value.tags.join('，')} />
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
                  setSources([...sources, { key: crypto.randomUUID(), type: 'url', title: '', content: '' }]);
                  onDirty();
                  openSource(sources.length);
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
              <Button type="submit" variant={onComplete ? 'outline' : 'default'} loading={pending}>
                保存选题
              </Button>
              {onComplete && (
                <Button type="submit" value="complete" loading={pending}>
                  {completed ? '确认选题并继续' : '标记选题完成'}
                </Button>
              )}
            </div>
          </div>
        </fieldset>
      </form>
      {selected !== null && (
        <SourceEditor
          key={sources[sourceIndex]?.key ?? selected}
          source={sources[sourceIndex]}
          index={sourceIndex}
          pending={pending}
          onBack={() => openSource(null)}
          onChange={(source) => {
            setSources(sources.map((item, index) => (index === sourceIndex ? source : item)));
            onDirty();
          }}
          onRemove={() => {
            setSources(sources.filter((_, index) => index !== sourceIndex));
            onDirty();
            openSource(null);
          }}
        />
      )}
    </>
  );
}
