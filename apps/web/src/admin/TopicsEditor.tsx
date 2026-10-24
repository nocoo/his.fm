import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EpisodeTopic } from '../shared/episode';

const emptyTopic = (): EpisodeTopic => ({ title: '', detail: '', sourceUrls: [] });

type TopicRow = { key: string; topic: EpisodeTopic };

function rowsFromTopics(topics: EpisodeTopic[]): TopicRow[] {
  return topics.map((topic) => ({ key: crypto.randomUUID(), topic }));
}

function parseUrls(value: string) {
  return value
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

export function TopicsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: EpisodeTopic[];
  onChange: (topics: EpisodeTopic[]) => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<TopicRow[]>(() => rowsFromTopics(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    setRows(rowsFromTopics(value));
  }, [value]);

  const updateRows = (next: TopicRow[]) => {
    setRows(next);
    const topics = next.map((row) => row.topic);
    lastEmitted.current = topics;
    onChange(topics);
  };

  const patch = (index: number, topic: EpisodeTopic) => {
    const next = [...rows];
    next[index] = { ...next[index], topic };
    updateRows(next);
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    updateRows(next);
  };

  return (
    <LayerCard padding="none">
      <LayerCard.Header>
        <strong>本期听点</strong>
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack studio-padding">
        <p className="admin-muted studio-prose">
          按节目顺序列出本期讲到的主题。标题用于目录与卡片预告，说明写展开后的内容；来源链接可留空。
        </p>
        {rows.map((row, index) => (
          <div key={row.key} className="studio-stack studio-mention-row">
            <Field label={`第 ${index + 1} 个主题`} htmlFor={`topic-title-${row.key}`} required>
              <Input
                id={`topic-title-${row.key}`}
                value={row.topic.title}
                disabled={disabled}
                maxLength={120}
                placeholder="例如：实验室怎样关住训练中的模型"
                onChange={(event) => patch(index, { ...row.topic, title: event.target.value })}
              />
            </Field>
            <Field label="展开说明" htmlFor={`topic-detail-${row.key}`}>
              <textarea
                id={`topic-detail-${row.key}`}
                className="studio-textarea"
                value={row.topic.detail}
                disabled={disabled}
                maxLength={2000}
                rows={3}
                placeholder="这一段讲到的具体内容，两到三句即可"
                onChange={(event) => patch(index, { ...row.topic, detail: event.target.value })}
              />
            </Field>
            <Field label="来源链接（可选）" htmlFor={`topic-sources-${row.key}`} hint="每行一个 HTTPS 地址">
              <textarea
                id={`topic-sources-${row.key}`}
                className="studio-textarea"
                value={row.topic.sourceUrls.join('\n')}
                disabled={disabled}
                rows={2}
                placeholder="https://"
                onChange={(event) =>
                  patch(index, { ...row.topic, sourceUrls: parseUrls(event.target.value) })
                }
              />
            </Field>
            <div className="studio-row">
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={16} /> 上移
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={16} /> 下移
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => updateRows(rows.filter((entry) => entry.key !== row.key))}
              >
                <Trash2 size={16} /> 移除
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || rows.length >= 30}
          onClick={() => updateRows([...rows, { key: crypto.randomUUID(), topic: emptyTopic() }])}
        >
          <Plus size={16} /> 添加一个主题
        </Button>
      </LayerCard.Body>
    </LayerCard>
  );
}
