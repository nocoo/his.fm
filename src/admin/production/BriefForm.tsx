import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { categories } from '../../shared/episode';
import type { ProductionBrief } from '../../shared/production';
import { Choice, Failure } from './controls';
import { readBrief } from './model';

export function BriefForm({
  value,
  pending,
  onSave,
  onDirty,
}: {
  value: ProductionBrief;
  pending: boolean;
  onSave: (brief: ProductionBrief) => Promise<void>;
  onDirty: () => void;
}) {
  const [sources, setSources] = useState(() =>
    value.sources.map((source) => ({ ...source, key: crypto.randomUUID() })),
  );
  const [category, setCategory] = useState(value.category);
  const [error, setError] = useState('');
  return (
    <form
      className="studio-stack"
      onChange={onDirty}
      onSubmit={async (event) => {
        event.preventDefault();
        const result = readBrief(
          new FormData(event.currentTarget),
          sources.map(({ key: _, ...source }) => source),
        );
        setError(result.error);
        if (result.data) await onSave(result.data);
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
              hint="告诉 Hermes 你想表达的观点、目标听众、讲述角度和不想涉及的内容。"
            >
              <InputArea
                id="production-intent"
                name="intent"
                defaultValue={value.intent}
                rows={6}
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
              }}
            >
              <Plus size={14} />
              添加素材
            </Button>
          </LayerCard.Header>
          <LayerCard.Body className="studio-stack studio-padding">
            {!sources.length && (
              <p className="admin-muted">添加文章链接、GitHub 仓库或文本。提交审核前至少需要一份素材。</p>
            )}
            {sources.map((source, index) => {
              const change = (field: 'type' | 'title' | 'content', next: string) => {
                setSources(
                  sources.map((item) => (item.key === source.key ? { ...item, [field]: next } : item)),
                );
                onDirty();
              };
              return (
                <LayerCard.Well key={source.key} className="studio-stack studio-padding">
                  <div className="studio-row">
                    <strong>素材 {index + 1}</strong>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`移除素材 ${index + 1}`}
                      onClick={() => {
                        setSources(sources.filter((item) => item.key !== source.key));
                        onDirty();
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  <Choice
                    label={`素材 ${index + 1} 类型`}
                    value={source.type}
                    disabled={pending}
                    onChange={(next) => change('type', next)}
                    options={[
                      { value: 'url', label: '文章链接' },
                      { value: 'github', label: 'GitHub 仓库' },
                      { value: 'text', label: '文本素材' },
                    ]}
                  />
                  <Field label="素材标题" htmlFor={`source-title-${source.key}`}>
                    <Input
                      id={`source-title-${source.key}`}
                      value={source.title}
                      maxLength={200}
                      onChange={(event) => change('title', event.target.value)}
                    />
                  </Field>
                  <Field
                    label={source.type === 'text' ? '素材正文' : 'HTTPS 链接'}
                    htmlFor={`source-content-${source.key}`}
                    required
                  >
                    <InputArea
                      id={`source-content-${source.key}`}
                      value={source.content}
                      maxLength={80000}
                      required
                      rows={source.type === 'text' ? 5 : 2}
                      onChange={(event) => change('content', event.target.value)}
                    />
                  </Field>
                </LayerCard.Well>
              );
            })}
          </LayerCard.Body>
        </LayerCard>
        <div className="studio-row">
          <p className="admin-muted">先保存选题，再提交给编辑审核。</p>
          <Button type="submit" loading={pending}>
            保存选题
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export function BriefRead({ value }: { value: ProductionBrief }) {
  return (
    <LayerCard padding="none">
      <LayerCard.Header>
        <strong>选题与原始素材</strong>
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack studio-padding">
        <p className="studio-prose">{value.intent || '尚未填写创作意图'}</p>
        <p className="admin-muted">
          第 {value.episodeNumber} 期 · 目标 {value.targetDurationSeconds / 60} 分钟 ·{' '}
          {value.tags.join(' / ') || '无标签'}
        </p>
        {value.sources.map((source, index) => (
          <details key={`${source.type}-${source.title}-${source.content}`}>
            <summary>
              {source.title || `素材 ${index + 1}`} · {source.type === 'text' ? '文本' : '链接'}
            </summary>
            {source.type === 'text' ? (
              <p className="studio-prose">{source.content}</p>
            ) : (
              <a className="studio-link" href={source.content} target="_blank" rel="noopener noreferrer">
                {source.content}
              </a>
            )}
          </details>
        ))}
      </LayerCard.Body>
    </LayerCard>
  );
}
