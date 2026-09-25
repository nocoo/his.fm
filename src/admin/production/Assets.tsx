import { Button, Field, LayerCard } from '@nocoo/basalt';
import { FileDropzone } from '@nocoo/basalt/components/file-dropzone';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { SegmentControl } from '@nocoo/basalt/components/segment-control';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nocoo/basalt/components/tabs';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Production } from '../../shared/production';
import { Confirm } from './controls';
import { audioBusy } from './model';
import { PromptPanel } from './PromptPanel';
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
  const [regenerate, setRegenerate] = useState(false);
  const [summary, setSummary] = useState(production.summary);
  const [description, setDescription] = useState(production.description);
  const [mode, setMode] = useState(description ? 'read' : 'edit');
  const copyDirty = summary !== production.summary || description !== production.description;
  useEffect(() => {
    onDirty(copyDirty || Boolean(cover));
  }, [copyDirty, cover, onDirty]);
  const busy = audioBusy(production);
  return (
    <Tabs defaultValue="cover" className="studio-stack">
      <p className="studio-location">
        三个任务可并行：封面和文案在本地计算机完成；完整音频由 Cloudflare 云端生成
      </p>
      <TabsList aria-label="成品素材">
        <TabsTrigger value="cover">封面</TabsTrigger>
        <TabsTrigger value="copy">发布文案</TabsTrigger>
        <TabsTrigger value="audio">音频</TabsTrigger>
      </TabsList>
      <TabsContent value="cover" className="studio-stack">
        <PromptPanel production={production} kind="cover" dirty={dirty} />
        <LayerCard>
          <div className="studio-stack">
            <CoverPreview production={production} />
            <FileDropzone
              label="上传节目封面"
              description="JPEG、PNG 或 WebP，最大 8 MB。先在本地叠加固定 his.fm 品牌边框。"
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
        <PromptPanel production={production} kind="description" dirty={dirty} />
        <div className="studio-row">
          <strong>摘要与发布简介</strong>
          <SegmentControl
            legend={<span className="sr-only">发布文案显示方式</span>}
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'read', label: '阅读' },
              { value: 'edit', label: '编辑' },
            ]}
          />
        </div>
        {mode === 'read' ? (
          <>
            <ReadingText text={summary || '尚未填写节目摘要。'} />
            <ReadingText text={description || '尚未填写发布简介。'} />
          </>
        ) : (
          <div className="studio-stack">
            <Field label="节目摘要" htmlFor="production-summary" hint="用于网站列表与分享，最多 2,000 字。">
              <InputArea
                className="studio-autosize"
                id="production-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={2000}
                rows={3}
                disabled={pending}
              />
            </Field>
            <Field label="发布简介" htmlFor="production-description" hint="小宇宙介绍，支持 Markdown。">
              <InputArea
                className="studio-autosize"
                id="production-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={20000}
                rows={10}
                disabled={pending}
              />
            </Field>
          </div>
        )}
        <div className="studio-actions">
          <Button
            variant="outline"
            loading={pending}
            disabled={!copyDirty}
            onClick={() => void onSave({ summary, description })}
          >
            保存发布文案
          </Button>
        </div>
      </TabsContent>
      <TabsContent value="audio" className="studio-stack">
        <p className="studio-location">
          Cloudflare 云端 · Gemini 3.8 Flash TTS · 自动合成片头、正文与片尾并存入 R2
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
            <div className="studio-actions">
              <Button
                loading={pending}
                disabled={dirty || production.audioJob?.status === 'running' || !production.approvals.script}
                onClick={() => {
                  if (production.assets.audio) setRegenerate(true);
                  else
                    void mutate(
                      () => productionService.audio(production.id, production.version),
                      '音频任务已开始',
                    );
                }}
              >
                {production.audioJob?.status === 'queued'
                  ? '重试派发音频任务'
                  : production.audioJob?.status === 'failed'
                    ? '重试生成音频'
                    : production.assets.audio
                      ? '重新生成音频'
                      : '生成完整音频'}
              </Button>
            </div>
            <p className="admin-muted">
              {!production.approvals.script && '先在逐字稿阶段标记完成。'}声音、片头和片尾在
              <Link className="studio-link" to="/admin/settings">
                工作室设置
              </Link>
              配置。任务开始后可以关闭浏览器，云端会继续执行。
            </p>
          </div>
        </LayerCard>
      </TabsContent>
      {regenerate && (
        <Confirm
          title="确认重新生成音频"
          description="会用当前已确认的逐字稿重新生成完整音频，成品需要再检查一次。"
          onClose={() => setRegenerate(false)}
          onConfirm={() =>
            mutate(() => productionService.audio(production.id, production.version), '音频任务已开始')
          }
        />
      )}
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
    </>
  ) : (
    <p className="admin-muted">尚未上传封面。复制封面任务，交给本地 agent 生成并叠加品牌边框。</p>
  );
}
function AudioPreview({ production }: { production: Production }) {
  const audio = production.assets.audio;
  return audio ? (
    <>
      <audio controls preload="metadata" src={audio.url}>
        <track kind="captions" />
      </audio>
      <p className="admin-muted">{Math.round(audio.durationSeconds ?? 0)} 秒 · 包含片头与片尾</p>
      {audio.scriptVersion !== production.scriptVersion && (
        <p className="studio-notice">这是旧版音频。请先确认当前逐字稿，再重新生成。</p>
      )}
      <a className="studio-link" href={audio.url} target="_blank" rel="noopener noreferrer">
        打开音频文件
      </a>
    </>
  ) : (
    <p className="admin-muted">尚未生成完整音频。云端会使用你确认过的逐字稿。</p>
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
