import { Button, Field } from '@nocoo/basalt';
import { useState } from 'react';
import type { Production } from '../../shared/production';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { PromptPanel } from './PromptPanel';

export function ScriptStage({
  production,
  pending,
  dirty,
  onDirty,
  onSave,
  onComplete,
}: {
  production: Production;
  pending: boolean;
  dirty: boolean;
  onDirty: () => void;
  onSave: (fields: { transcript: string }) => Promise<void>;
  onComplete: (fields: { transcript: string }) => Promise<void>;
}) {
  const [text, setText] = useState(production.transcript);
  return (
    <div className="studio-stack">
      <p className="studio-location">
        本地计算机生成 · 在当前浏览器阅读、修改与确认 · 确认后云端才会生成声音
      </p>
      <PromptPanel production={production} kind="script" dirty={dirty} />
      <Field
        label={`逐字稿 · 第 ${production.scriptVersion} 版`}
        htmlFor="production-transcript"
        hint="修改后需重新确认并制作当前版本，已有封面和音频会保留。"
      >
        <MarkdownEditor
          id="production-transcript"
          label="完整逐字稿"
          value={text}
          defaultMode={production.transcript ? 'preview' : 'edit'}
          previewClassName="studio-transcript"
          onChange={(next) => {
            setText(next);
            onDirty();
          }}
          maxLength={50000}
          disabled={pending}
        />
      </Field>
      <div className="studio-stage-footer">
        <p className="admin-muted">
          {production.approvals.brief
            ? '读完并确认这份稿子后，标记本阶段完成。'
            : '可以先写稿；标记完成前，请先完成选题。'}
        </p>
        <div className="studio-actions">
          <Button
            variant="outline"
            disabled={pending || !dirty}
            onClick={() => void onSave({ transcript: text })}
          >
            保存逐字稿
          </Button>
          <Button
            loading={pending}
            disabled={!text.trim() || !production.approvals.brief}
            onClick={() => void onComplete({ transcript: text })}
          >
            {production.approvals.script && !dirty ? '继续到成品制作' : '标记逐字稿完成'}
          </Button>
        </div>
      </div>
    </div>
  );
}
