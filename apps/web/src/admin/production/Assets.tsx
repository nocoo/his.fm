import { Button, Field, LayerCard } from '@nocoo/basalt';
import { FileDropzone } from '@nocoo/basalt/components/file-dropzone';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nocoo/basalt/components/tabs';
import { useEffect, useState } from 'react';
import type { Production } from '../../shared/production';
import { useAgentField, useDraft } from '../agent/AgentProvider';
import { DraftConflicts } from '../agent/DraftConflicts';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { AudioGeneration } from './AudioGeneration';
import { CoverDownload } from './CoverDownload';
import { audioBusy } from './model';
import { ReadingText } from './ReadingText';
import { productionService } from './service';

export function Assets({
  production,
  pending,
  dirty,
  onDirty,
  onSave,
  mutate,
}: {
  production: Production;
  pending: boolean;
  dirty: boolean;
  onDirty: (dirty: boolean) => void;
  onSave: (fields: { summary: string; description: string }) => Promise<void>;
  mutate: (operation: () => Promise<{ production: Production }>, message: string) => Promise<boolean>;
}) {
  const [cover, setCover] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const draft = useDraft({ summary: production.summary, description: production.description });
  const { summary, description } = draft.value;
  const summaryField = useAgentField(
    { productionId: production.id, field: 'summary' },
    summary,
    production.summary,
    (next) => draft.change('summary', next),
    pending || draft.conflicts.length > 0,
  );
  const descriptionField = useAgentField(
    { productionId: production.id, field: 'description' },
    description,
    production.description,
    (next) => draft.change('description', next),
    pending || draft.conflicts.length > 0,
  );
  const copyDirty = summary !== production.summary || description !== production.description;
  useEffect(() => {
    onDirty(copyDirty || Boolean(cover));
  }, [copyDirty, cover, onDirty]);
  const busy = audioBusy(production);
  return (
    <Tabs defaultValue="cover" className="studio-stack">
      <p className="studio-location">
        三个任务可并行：封面和文案在本地计算机完成；正文音频由 Cloudflare 云端生成
      </p>
      <TabsList aria-label="成品素材">
        <TabsTrigger value="cover">封面</TabsTrigger>
        <TabsTrigger value="copy">发布文案</TabsTrigger>
        <TabsTrigger value="audio">音频</TabsTrigger>
      </TabsList>
      <TabsContent value="cover" className="studio-stack">
        <LayerCard>
          <div className="studio-stack">
            <CoverPreview production={production} />
            <FileDropzone
              label="上传节目封面"
              description="JPEG、PNG 或 WebP，最大 8 MB。只上传干净原图，不得包含品牌字标、边框或叠加层。"
              accept="image/jpeg,image/png,image/webp"
              multiple={false}
              maxSize={8 * 1024 * 1024}
              disabled={pending}
              browseLabel="选择封面"
              dropLabel="松开以上传封面"
              formatRejection={() => '请选择 8 MB 以内的 JPEG、PNG 或 WebP 图片。'}
              onFilesAccepted={([file]) => {
                setCover(file);
                setUploadError('');
              }}
              onFilesRejected={() => setUploadError('图片格式或大小不符合要求。')}
            />
            {cover && (
              <div className="studio-row">
                <span className="studio-wrap">{cover.name}</span>
                <Button
                  loading={pending}
                  disabled={copyDirty}
                  onClick={async () => {
                    if (
                      await mutate(
                        () => productionService.cover(production.id, production.version, cover),
                        '封面已上传',
                      )
                    )
                      setCover(null);
                  }}
                >
                  上传封面
                </Button>
              </div>
            )}
            {uploadError && (
              <p className="admin-error" role="alert">
                {uploadError}
              </p>
            )}
            {copyDirty && <p className="admin-muted">先保存发布文案，再上传封面。</p>}
          </div>
        </LayerCard>
      </TabsContent>
      <TabsContent value="copy" className="studio-stack">
        <DraftConflicts fields={draft.conflicts} resolve={draft.resolve} />
        <Field label="节目摘要" htmlFor="production-summary" hint="用于网站列表与分享，最多 2,000 字。">
          <InputArea
            className="studio-autosize"
            id="production-summary"
            value={summary}
            onFocus={summaryField.onFocus}
            onChange={(event) => summaryField.onChange(event.target.value)}
            onSelect={(event) => {
              const input = event.currentTarget;
              summaryField.onSelection({
                from: input.selectionStart,
                to: input.selectionEnd,
                text: input.value.slice(input.selectionStart, input.selectionEnd),
              });
            }}
            onCompositionStart={() => summaryField.onComposition(true)}
            onCompositionEnd={() => summaryField.onComposition(false)}
            maxLength={2000}
            rows={3}
            disabled={pending}
          />
        </Field>
        <Field label="发布简介" htmlFor="production-description" hint="小宇宙介绍，支持 Markdown。">
          <MarkdownEditor
            id="production-description"
            label="发布简介"
            value={description}
            onChange={descriptionField.onChange}
            onSelection={descriptionField.onSelection}
            onComposition={descriptionField.onComposition}
            defaultMode={production.description ? 'preview' : 'edit'}
            maxLength={20000}
            disabled={pending}
          />
        </Field>
        <div className="studio-actions">
          <Button
            variant="outline"
            loading={pending}
            disabled={!copyDirty || draft.conflicts.length > 0}
            onClick={() => void onSave({ summary, description })}
          >
            保存发布文案
          </Button>
        </div>
      </TabsContent>
      <TabsContent value="audio" className="studio-stack">
        <p className="studio-location">
          Cloudflare 云端 · Gemini 3.8 Flash TTS · 生成正文，可选添加片头片尾，完成后存入 R2
        </p>
        <LayerCard>
          <div className="studio-stack">
            <AudioPreview production={production} />
            <p role="status">
              {busy
                ? production.audioJob?.status === 'queued'
                  ? '已进入生成队列，进度会自动更新。'
                  : '正在生成音频，进度会自动更新。'
                : production.audioJob?.status === 'failed'
                  ? '音频生成失败，可以重试。'
                  : production.assets.audio &&
                      production.assets.audio.scriptVersion === production.scriptVersion
                    ? '音频制作完成'
                    : '等待生成当前版本音频'}
            </p>
            {production.audioJob?.error && (
              <p className="admin-error" role="alert">
                {production.audioJob.error}
              </p>
            )}
            <AudioGeneration production={production} pending={pending} dirty={dirty} mutate={mutate} />
          </div>
        </LayerCard>
      </TabsContent>
    </Tabs>
  );
}
function CoverPreview({ production }: { production: Production }) {
  const cover = production.assets.cover;
  return cover ? (
    <>
      <img className="studio-cover" src={cover.url} alt={`${production.title}的节目封面`} />
      {cover.scriptVersion !== production.scriptVersion && (
        <p className="studio-notice">这是旧版封面。请按当前逐字稿重新制作并上传。</p>
      )}
      <a className="studio-link" href={cover.url} target="_blank" rel="noopener noreferrer">
        打开封面原图
      </a>
      <CoverDownload source={cover.url} episodeNumber={production.episodeNumber} />
    </>
  ) : (
    <p className="admin-muted">尚未上传封面。和主控讨论并生成干净原图。品牌框架仅在下载成品时叠加。</p>
  );
}
function AudioPreview({ production }: { production: Production }) {
  const audio = production.assets.audio;
  return audio ? (
    <>
      <audio controls preload="metadata" src={audio.url}>
        <track kind="captions" />
      </audio>
      <p className="admin-muted">
        {Math.round(audio.durationSeconds ?? 0)} 秒{audio.voice ? ` · ${audio.voice}` : ''} ·{' '}
        {audio.includesBumpers ? '含片头与片尾' : '正文音频'}
      </p>
      {audio.scriptVersion !== production.scriptVersion && (
        <p className="studio-notice">这是旧版音频。请先确认当前逐字稿，再重新生成。</p>
      )}
      <a className="studio-link" href={audio.url} target="_blank" rel="noopener noreferrer">
        打开音频文件
      </a>
    </>
  ) : (
    <p className="admin-muted">尚未生成正文音频。云端会使用你确认过的逐字稿。</p>
  );
}
export function FinalReview({ production }: { production: Production }) {
  return (
    <div className="studio-stack">
      <div className="studio-grid">
        <LayerCard>
          <div className="studio-stack">
            <strong>封面检查</strong>
            <CoverPreview production={production} />
          </div>
        </LayerCard>
        <LayerCard>
          <div className="studio-stack">
            <strong>完整试听</strong>
            <AudioPreview production={production} />
          </div>
        </LayerCard>
      </div>
      <strong>节目摘要</strong>
      <ReadingText text={production.summary || '摘要尚未准备。'} />
      <strong>发布简介</strong>
      <ReadingText text={production.description || '发布简介尚未准备。'} />
    </div>
  );
}
