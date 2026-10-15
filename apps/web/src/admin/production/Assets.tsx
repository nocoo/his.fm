import { Button, Field, LayerCard } from '@nocoo/basalt';
import { FileDropzone } from '@nocoo/basalt/components/file-dropzone';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { useEffect, useState } from 'react';
import { AudioPlayer } from '../../components/AudioPlayer';
import type { Production } from '../../shared/production';
import { DraftConflicts } from '../draft/DraftConflicts';
import { useDraft } from '../draft/useDraft';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { CoverDownload } from './CoverDownload';
import { Confirm } from './controls';
import { ReadingText } from './ReadingText';
import { productionService } from './service';

export function Assets({
  production,
  pending,
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
  const [audio, setAudio] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [detach, setDetach] = useState<'cover' | 'audio' | null>(null);
  const draft = useDraft({ summary: production.summary, description: production.description });
  useEffect(() => onDirty(draft.dirty || Boolean(cover || audio)), [draft.dirty, cover, audio, onDirty]);
  const blocked = pending || draft.dirty || draft.conflicts.length > 0;
  return (
    <div className="studio-stack">
      <p className="admin-muted">
        外部工具制作成品，在此上传干净原图与完整音频。上传不会覆盖原文件，解除关联也不会删除存储中的原件。
      </p>
      <div className="studio-grid studio-assets-grid">
        <LayerCard className="studio-stack">
          <strong>节目封面</strong>
          <CoverPreview production={production} />
          <FileDropzone
            label={production.assets.cover ? '替换节目封面' : '上传节目封面'}
            description="JPEG、PNG 或 WebP，最大 8 MB。只上传无文字、标志、边框的干净原图。"
            accept="image/jpeg,image/png,image/webp"
            multiple={false}
            maxSize={8 * 1024 * 1024}
            disabled={pending}
            browseLabel="选择封面"
            formatRejection={() => '请选择 8 MB 以内的 JPEG、PNG 或 WebP 图片。'}
            onFilesAccepted={([file]) => {
              setCover(file);
              setError('');
            }}
            onFilesRejected={() => setError('封面格式或大小不符合要求。')}
          />
          {cover && (
            <div className="studio-row">
              <span className="studio-wrap">{cover.name}</span>
              <div className="studio-actions">
                <Button variant="ghost" disabled={pending} onClick={() => setCover(null)}>
                  取消选择
                </Button>
                <Button
                  loading={pending}
                  disabled={blocked}
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
            </div>
          )}
          {production.assets.cover && (
            <Button
              variant="ghost"
              disabled={blocked || Boolean(cover || audio)}
              onClick={() => setDetach('cover')}
            >
              解除封面关联
            </Button>
          )}
        </LayerCard>
        <LayerCard className="studio-stack">
          <strong>完整音频</strong>
          <AudioPreview production={production} />
          <FileDropzone
            label={production.assets.audio ? '替换节目音频' : '上传节目音频'}
            description="WAV / 24 kHz / 单声道 / 16-bit PCM，最长 30 分钟、最大 86,465,536 字节。服务器检查格式并读取真实时长。"
            accept="audio/wav,.wav"
            multiple={false}
            maxSize={86465536}
            disabled={pending}
            browseLabel="选择 WAV 音频"
            formatRejection={() => '请选择大小不超过 86,465,536 字节的 WAV 文件。'}
            onFilesAccepted={([file]) => {
              setAudio(file);
              setError('');
            }}
            onFilesRejected={() => setError('音频格式或大小不符合要求。')}
          />
          {audio && (
            <div className="studio-row">
              <span className="studio-wrap">{audio.name}</span>
              <div className="studio-actions">
                <Button variant="ghost" disabled={pending} onClick={() => setAudio(null)}>
                  取消选择
                </Button>
                <Button
                  loading={pending}
                  disabled={blocked || !production.approvals.script}
                  onClick={async () => {
                    if (
                      await mutate(
                        () => productionService.audio(production.id, production.version, audio),
                        '音频已上传',
                      )
                    )
                      setAudio(null);
                  }}
                >
                  上传音频
                </Button>
              </div>
            </div>
          )}
          {!production.approvals.script && (
            <p className="admin-muted">确认逐字稿后，才能上传对应版本的音频。</p>
          )}
          {production.assets.audio && (
            <Button
              variant="ghost"
              disabled={blocked || Boolean(cover || audio)}
              onClick={() => setDetach('audio')}
            >
              解除音频关联
            </Button>
          )}
        </LayerCard>
      </div>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {draft.dirty && <p className="admin-muted">先保存发布文案，再上传或解除资产关联。</p>}
      <LayerCard className="studio-stack">
        <strong>发布文案</strong>
        <DraftConflicts fields={draft.conflicts} resolve={draft.resolve} />
        <Field label="节目摘要" htmlFor="production-summary" hint="用于网站列表与分享，最多 2,000 字。">
          <InputArea
            id="production-summary"
            value={draft.value.summary}
            onChange={(event) => draft.change('summary', event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={pending}
          />
        </Field>
        <Field label="发布简介" htmlFor="production-description">
          <MarkdownEditor
            id="production-description"
            label="发布简介"
            value={draft.value.description}
            defaultMode={production.description ? 'preview' : 'edit'}
            onChange={(next) => draft.change('description', next)}
            maxLength={20000}
            disabled={pending}
          />
        </Field>
        <div className="studio-actions">
          <Button
            disabled={pending || !draft.dirty || draft.conflicts.length > 0}
            onClick={() => void onSave(draft.value)}
          >
            保存发布文案
          </Button>
        </div>
      </LayerCard>
      {detach && (
        <Confirm
          title={`解除${detach === 'cover' ? '封面' : '音频'}关联`}
          description="当前节目将不再使用这份资产；原件和已发布快照保留。最终批准将被撤销，重新发布前需完成检查。"
          onClose={() => setDetach(null)}
          onConfirm={() =>
            mutate(
              () => productionService.detach(production.id, production.version, detach),
              '资产关联已解除',
            )
          }
        />
      )}
    </div>
  );
}
function CoverPreview({ production }: { production: Production }) {
  const cover = production.assets.cover;
  return cover ? (
    <>
      <img className="studio-cover" src={cover.url} alt={`${production.title}的节目封面`} />
      {cover.scriptVersion !== production.scriptVersion && (
        <p className="studio-notice">这是旧版封面，请上传对应当前逐字稿的成品。</p>
      )}
      <div className="studio-row">
        <a className="studio-link" href={cover.url} target="_blank" rel="noopener noreferrer">
          打开封面原图 ↗
        </a>
        <CoverDownload source={cover.url} episodeNumber={production.episodeNumber} />
      </div>
      <AssetInfo asset={cover} />
    </>
  ) : (
    <p className="admin-muted">尚未上传封面。品牌框架仅在下载成品时叠加。</p>
  );
}
function AudioPreview({ production }: { production: Production }) {
  const audio = production.assets.audio;
  return audio ? (
    <>
      <AudioPlayer
        src={audio.url}
        title={production.title}
        coverUrl={production.assets.cover?.url}
        subtitle={`第 ${production.episodeNumber} 期 · 完整音频`}
        compact
      />
      <p className="admin-muted">
        {Math.round(audio.durationSeconds ?? 0)} 秒{audio.voice ? ` · ${audio.voice}` : ''}
        {audio.includesBumpers ? ' · 含片头与片尾' : ''}
      </p>
      {audio.scriptVersion !== production.scriptVersion && (
        <p className="studio-notice">这是旧版音频，请上传对应当前逐字稿的成品。</p>
      )}
      <a className="studio-link" href={audio.url} target="_blank" rel="noopener noreferrer">
        打开音频原件 ↗
      </a>
      <AssetInfo asset={audio} />
    </>
  ) : (
    <p className="admin-muted">尚未上传完整音频。</p>
  );
}
function AssetInfo({ asset }: { asset: NonNullable<Production['assets']['audio']> }) {
  return (
    <details className="studio-asset-info admin-muted">
      <summary>
        原件信息 · 逐字稿 v{asset.scriptVersion} · {(asset.size / 1024 / 1024).toFixed(2)} MB
      </summary>
      <code className="studio-wrap">{asset.key}</code>
      <p>
        {asset.mimeType} · {new Date(asset.createdAt).toLocaleString('zh-CN')}
      </p>
    </details>
  );
}
export function FinalReview({ production }: { production: Production }) {
  return (
    <div className="studio-stack">
      <div className="studio-grid">
        <LayerCard className="studio-stack">
          <strong>封面检查</strong>
          <CoverPreview production={production} />
        </LayerCard>
        <LayerCard className="studio-stack">
          <strong>完整试听</strong>
          <AudioPreview production={production} />
        </LayerCard>
      </div>
      <strong>节目摘要</strong>
      <ReadingText text={production.summary || '摘要尚未准备。'} />
      <strong>发布简介</strong>
      <ReadingText text={production.description || '发布简介尚未准备。'} />
    </div>
  );
}
