import { Button, Field } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { SegmentControl } from '@nocoo/basalt/components/segment-control';
import { useState } from 'react';
import type { Production } from '../../shared/production';
import { PromptPanel } from './PromptPanel';
import { ReadingText } from './ReadingText';

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
  const [mode, setMode] = useState(text ? 'read' : 'edit');
  return (
    <div className="studio-stack">
      <p className="studio-location">
        本地计算机生成 · 在当前浏览器阅读、修改与确认 · 确认后云端才会生成声音
      </p>
      <PromptPanel production={production} kind="script" dirty={dirty} />
      <div className="studio-row">
        <strong>
          逐字稿 · 第 {production.scriptVersion} 版 · {text.length.toLocaleString('zh-CN')} 字
        </strong>
        <SegmentControl
          legend={<span className="sr-only">逐字稿显示方式</span>}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'read', label: '阅读' },
            { value: 'edit', label: '编辑' },
          ]}
        />
      </div>
      {mode === 'read' ? (
        text ? (
          <ReadingText text={text} className="studio-transcript" />
        ) : (
          <p className="admin-muted">
            还没有逐字稿。将上方任务交给本地 agent，完成后刷新，或切到编辑直接填写。
          </p>
        )
      ) : (
        <Field
          label="完整逐字稿"
          htmlFor="production-transcript"
          hint="可随时修改，已有封面和音频会保留；修改后需要重新确认并制作当前版本。"
        >
          <InputArea
            className="studio-autosize"
            id="production-transcript"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onDirty();
            }}
            maxLength={50000}
            rows={12}
            disabled={pending}
          />
        </Field>
      )}
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
