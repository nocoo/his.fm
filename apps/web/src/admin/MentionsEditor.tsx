import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Mention } from '../shared/mentions';

const emptyMention = (): Mention => ({ name: '', description: '' });

type MentionRow = { key: string; mention: Mention };

function rowsFromMentions(mentions: Mention[]): MentionRow[] {
  return mentions.map((mention) => ({ key: crypto.randomUUID(), mention }));
}

export function MentionsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Mention[];
  onChange: (mentions: Mention[]) => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<MentionRow[]>(() => rowsFromMentions(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    setRows(rowsFromMentions(value));
  }, [value]);

  const updateRows = (next: MentionRow[]) => {
    setRows(next);
    const mentions = next.map((row) => row.mention);
    lastEmitted.current = mentions;
    onChange(mentions);
  };

  return (
    <LayerCard padding="none">
      <LayerCard.Header>
        <strong>本期提到</strong>
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack studio-padding">
        <p className="admin-muted studio-prose">
          按播出顺序列出本期提到的人、作品或资料。每项需填写名称和一句话说明；链接可选。
        </p>
        {rows.map((row, index) => (
          <div key={row.key} className="studio-stack studio-mention-row">
            <div className="studio-grid">
              <Field label="名称" htmlFor={`mention-name-${row.key}`} required>
                <Input
                  id={`mention-name-${row.key}`}
                  value={row.mention.name}
                  disabled={disabled}
                  maxLength={200}
                  onChange={(event) => {
                    const next = [...rows];
                    next[index] = { ...row, mention: { ...row.mention, name: event.target.value } };
                    updateRows(next);
                  }}
                />
              </Field>
              <Field label="链接（可选）" htmlFor={`mention-url-${row.key}`}>
                <Input
                  id={`mention-url-${row.key}`}
                  value={row.mention.url ?? ''}
                  disabled={disabled}
                  maxLength={2048}
                  placeholder="https://"
                  onChange={(event) => {
                    const next = [...rows];
                    const url = event.target.value.trim();
                    next[index] = {
                      ...row,
                      mention: { ...row.mention, url: url || undefined },
                    };
                    updateRows(next);
                  }}
                />
              </Field>
            </div>
            <Field label="说明" htmlFor={`mention-description-${row.key}`} required>
              <Input
                id={`mention-description-${row.key}`}
                value={row.mention.description}
                disabled={disabled}
                maxLength={500}
                placeholder="一句话说明它是什么、与本期有何关系"
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = {
                    ...row,
                    mention: { ...row.mention, description: event.target.value },
                  };
                  updateRows(next);
                }}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => updateRows(rows.filter((entry) => entry.key !== row.key))}
            >
              <Trash2 size={16} /> 移除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || rows.length >= 50}
          onClick={() => updateRows([...rows, { key: crypto.randomUUID(), mention: emptyMention() }])}
        >
          <Plus size={16} /> 添加一条
        </Button>
      </LayerCard.Body>
    </LayerCard>
  );
}
