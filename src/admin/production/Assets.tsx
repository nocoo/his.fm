import { Button, Field, LayerCard } from '@nocoo/basalt';
import { FileDropzone } from '@nocoo/basalt/components/file-dropzone';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Production } from '../../shared/production';
import { Confirm } from './controls';
import { audioBusy, finalMissing } from './model';
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
  onDirty: () => void;
  onSave: (fields: { summary: string; description: string }) => Promise<void>;
  mutate: (operation: () => Promise<{ production: Production }>, message: string) => Promise<boolean>;
}) {
  const [cover, setCover] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [regenerate, setRegenerate] = useState(false);
  const editable = production.stage === 'production';
  const busy = audioBusy(production);
  const missing = finalMissing(production);
  return (
    <div className="studio-stack">
      <div className="studio-grid">
        <LayerCard padding="none">
          <LayerCard.Header>
            <strong>封面</strong>
          </LayerCard.Header>
          <LayerCard.Body className="studio-stack studio-padding">
            {production.assets.cover ? (
              <>
                <img
                  className="studio-cover"
                  src={production.assets.cover.url}
                  alt={`${production.title}的节目封面`}
                />
                <a
                  className="studio-link"
                  href={production.assets.cover.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开封面原图
                </a>
              </>
            ) : (
              <LayerCard.Empty
                title="封面待制作"
                description="复制封面提示词交给 Hermes，完成后在这里上传图片。"
              />
            )}
            {editable && (
              <>
                <FileDropzone
                  label="上传节目封面"
                  description="JPEG、PNG 或 WebP，最大 8 MB。"
                  accept="image/jpeg,image/png,image/webp"
                  multiple={false}
                  maxSize={8 * 1024 * 1024}
                  disabled={pending || dirty}
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
                      disabled={dirty}
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
              </>
            )}
          </LayerCard.Body>
        </LayerCard>
        <LayerCard padding="none">
          <LayerCard.Header>
            <strong>完整音频</strong>
          </LayerCard.Header>
          <LayerCard.Body className="studio-stack studio-padding">
            {production.assets.audio ? (
              <>
                <audio controls preload="metadata" src={production.assets.audio.url}>
                  <track kind="captions" />
                </audio>
                <p className="admin-muted">
                  {Math.round(production.assets.audio.durationSeconds ?? 0)} 秒 · 包含片头与片尾
                </p>
                <a
                  className="studio-link"
                  href={production.assets.audio.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开音频文件
                </a>
              </>
            ) : (
              <p className="admin-muted">使用已人工批准的逐字稿生成声音，并自动拼接片头与片尾。</p>
            )}
            <p role="status">
              {busy
                ? production.audioJob?.status === 'queued'
                  ? '已进入生成队列，进度会自动更新。'
                  : '正在生成音频，进度会自动更新。'
                : production.audioJob?.status === 'failed'
                  ? '音频生成失败，可以重试。'
                  : production.assets.audio
                    ? '音频制作完成'
                    : '尚未生成音频'}
            </p>
            {production.audioJob?.error && (
              <p className="admin-error" role="alert">
                {production.audioJob.error}
              </p>
            )}
            {editable && (
              <>
                <Button
                  loading={pending}
                  disabled={dirty || production.audioJob?.status === 'running'}
                  onClick={() => {
                    if (production.assets.audio) setRegenerate(true);
                    else
                      void mutate(
                        () => productionService.audio(production.id, production.version),
                        '音频任务已提交',
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
                <p className="admin-muted">
                  生成前请在
                  <Link className="studio-link" to="/admin/settings">
                    工作室设置
                  </Link>
                  完成声音、片头和片尾配置。
                </p>
              </>
            )}
          </LayerCard.Body>
        </LayerCard>
      </div>
      <LayerCard padding="none">
        <LayerCard.Header>
          <strong>摘要与发布简介</strong>
        </LayerCard.Header>
        <LayerCard.Body className="studio-padding">
          {editable ? (
            <form
              className="studio-stack"
              onChange={onDirty}
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                await onSave({
                  summary: String(form.get('summary')),
                  description: String(form.get('description')),
                });
              }}
            >
              <fieldset className="studio-fieldset studio-stack" disabled={pending}>
                <Field
                  label="节目摘要"
                  htmlFor="production-summary"
                  hint="网站列表与分享使用，最多 2,000 字。"
                >
                  <InputArea
                    id="production-summary"
                    name="summary"
                    rows={3}
                    maxLength={2000}
                    defaultValue={production.summary}
                  />
                </Field>
                <Field
                  label="发布简介"
                  htmlFor="production-description"
                  hint="用于小宇宙节目介绍，可使用 Markdown 组织内容与链接。"
                >
                  <InputArea
                    id="production-description"
                    name="description"
                    rows={10}
                    maxLength={20000}
                    defaultValue={production.description}
                  />
                </Field>
                <div className="studio-row">
                  <span className="admin-muted">先保存文案，再上传素材或提交审核。</span>
                  <Button type="submit" loading={pending}>
                    保存发布文案
                  </Button>
                </div>
              </fieldset>
            </form>
          ) : (
            <div className="studio-stack">
              {regenerate && (
                <Confirm
                  title="确认重新生成音频"
                  description="现有音频将从当前制作中移除，生成完成前不能提交成品审核。"
                  onClose={() => setRegenerate(false)}
                  onConfirm={() =>
                    mutate(() => productionService.audio(production.id, production.version), '音频任务已提交')
                  }
                />
              )}
              <div>
                <strong>节目摘要</strong>
                <p className="studio-prose">{production.summary}</p>
              </div>
              <div>
                <strong>发布简介</strong>
                <p className="studio-prose">{production.description}</p>
              </div>
            </div>
          )}
        </LayerCard.Body>
      </LayerCard>
      <p className="admin-muted">
        {missing.length
          ? `仍需完成：${missing.join('、')}`
          : '封面、完整音频与发布文案均已就绪，请逐项检查后提交人工确认。'}
      </p>
    </div>
  );
}
