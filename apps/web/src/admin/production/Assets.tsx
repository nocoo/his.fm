import {
  Button,
  Field,
  LayerCard,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@nocoo/basalt';
import { FileDropzone } from '@nocoo/basalt/components/file-dropzone';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { CircleHelp, ExternalLink, Link2Off, Replace } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AudioPlayer } from '../../components/AudioPlayer';
import { FramedCover } from '../../components/FramedCover';
import {
  type Production,
  productionAudioMaxBytes,
  productionAudioMp3MaxBytes,
} from '../../shared/production';
import { DraftConflicts } from '../draft/DraftConflicts';
import { useDraft } from '../draft/useDraft';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { TopicsEditor } from '../TopicsEditor';
import { CoverDownload } from './CoverDownload';
import { Confirm } from './controls';
import { ReadingText } from './ReadingText';
import { productionService } from './service';

const coverRules =
  'JPEG、PNG 或 WebP，最大 8 MB。只上传无文字、标志、边框的干净原图；品牌框架仅在下载成品时叠加。';
const audioRules =
  'WAV：24 kHz / 单声道 / 16-bit PCM，最大 172,865,536 字节。MP3：audio/mpeg，推荐 96–128 kbps 单声道，最大 144,065,536 字节。最长 3600 秒；服务器检查格式并读取真实时长。';

export function Assets({
  production,
  categoryName,
  pending,
  onDirty,
  onSave,
  mutate,
}: {
  production: Production;
  categoryName: string;
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
  const [replaceCover, setReplaceCover] = useState(!production.assets.cover);
  const [replaceAudio, setReplaceAudio] = useState(!production.assets.audio);
  const draft = useDraft({
    summary: production.summary,
    lead: production.lead,
    researchNote: production.researchNote,
    credits: production.credits,
    body: production.body,
    topics: production.topics,
    description: production.description,
  });
  useEffect(() => onDirty(draft.dirty || Boolean(cover || audio)), [draft.dirty, cover, audio, onDirty]);
  useEffect(() => {
    if (!production.assets.cover) setReplaceCover(true);
    if (!production.assets.audio) setReplaceAudio(true);
  }, [production.assets.cover, production.assets.audio]);
  const blocked = pending || draft.dirty || draft.conflicts.length > 0;
  return (
    <div className="studio-stack">
      <p className="admin-muted">
        外部工具制作成品，在此上传干净原图与完整音频。上传不会覆盖原文件，解除关联也不会删除存储中的原件。
      </p>
      <div className="studio-grid studio-assets-grid">
        <LayerCard className="studio-asset-card">
          <div className="studio-asset-card-head">
            <strong>节目封面</strong>
            {production.assets.cover && (
              <AssetMetadataPopover
                asset={production.assets.cover}
                scriptVersion={production.scriptVersion}
              />
            )}
            <div className="studio-asset-card-tools">
              {production.assets.cover && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="替换节目封面"
                        disabled={blocked || Boolean(cover || audio)}
                        onClick={() => setReplaceCover((open) => !open)}
                      >
                        <Replace size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>替换封面</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="解除封面关联"
                        disabled={blocked || Boolean(cover || audio)}
                        onClick={() => setDetach('cover')}
                      >
                        <Link2Off size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>解除关联</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
          <div className="studio-asset-card-body">
            <CoverPreview production={production} categoryName={categoryName} />
          </div>
          {replaceCover && (
            <div className="studio-asset-upload">
              <p className="admin-muted studio-asset-upload-hint">
                格式要求
                <AssetRulesPopover label="封面上传格式" rules={coverRules} />
              </p>
              <FileDropzone
                label={production.assets.cover ? '替换节目封面' : '上传节目封面'}
                description={coverRules}
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
                        ) {
                          setCover(null);
                          setReplaceCover(false);
                        }
                      }}
                    >
                      上传封面
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </LayerCard>
        <LayerCard className="studio-asset-card">
          <div className="studio-asset-card-head">
            <strong>完整音频</strong>
            {production.assets.audio && (
              <AssetMetadataPopover
                asset={production.assets.audio}
                scriptVersion={production.scriptVersion}
              />
            )}
            <div className="studio-asset-card-tools">
              {production.assets.audio && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="替换节目音频"
                        disabled={blocked || Boolean(cover || audio)}
                        onClick={() => setReplaceAudio((open) => !open)}
                      >
                        <Replace size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>替换音频</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="解除音频关联"
                        disabled={blocked || Boolean(cover || audio)}
                        onClick={() => setDetach('audio')}
                      >
                        <Link2Off size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>解除关联</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
          <div className="studio-asset-card-body">
            <AudioPreview production={production} categoryName={categoryName} />
          </div>
          {replaceAudio && (
            <div className="studio-asset-upload">
              <p className="admin-muted studio-asset-upload-hint">
                格式要求
                <AssetRulesPopover label="音频上传格式" rules={audioRules} />
              </p>
              <FileDropzone
                label={production.assets.audio ? '替换节目音频' : '上传节目音频'}
                description={audioRules}
                accept="audio/wav,.wav,audio/mpeg,.mp3"
                multiple={false}
                maxSize={Math.max(productionAudioMaxBytes, productionAudioMp3MaxBytes)}
                disabled={pending}
                browseLabel="选择 WAV 或 MP3 音频"
                formatRejection={() => '请选择符合大小与格式要求的 WAV 或 MP3 文件。'}
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
                        ) {
                          setAudio(null);
                          setReplaceAudio(false);
                        }
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
            </div>
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
        <Field label="开篇导语" htmlFor="production-lead" hint="节目开始时的一段话。">
          <MarkdownEditor
            id="production-lead"
            label="开篇导语"
            value={draft.value.lead}
            onChange={(next) => draft.change('lead', next)}
            maxLength={4000}
            disabled={pending}
          />
        </Field>
        <TopicsEditor
          value={draft.value.topics}
          disabled={pending}
          onChange={(next) => draft.change('topics', next)}
        />
        <Field label="其余正文" htmlFor="production-body" hint="不属于听点的补充段落，可留空。">
          <MarkdownEditor
            id="production-body"
            label="其余正文"
            value={draft.value.body}
            onChange={(next) => draft.change('body', next)}
            maxLength={20000}
            disabled={pending}
          />
        </Field>
        <Field label="研究边界" htmlFor="production-research-note">
          <MarkdownEditor
            id="production-research-note"
            label="研究边界"
            value={draft.value.researchNote}
            onChange={(next) => draft.change('researchNote', next)}
            maxLength={4000}
            disabled={pending}
          />
        </Field>
        <Field label="致谢与许可" htmlFor="production-credits">
          <MarkdownEditor
            id="production-credits"
            label="致谢与许可"
            value={draft.value.credits}
            onChange={(next) => draft.change('credits', next)}
            maxLength={4000}
            disabled={pending}
          />
        </Field>
        <Field
          label="旧版发布简介（迁移中）"
          htmlFor="production-description"
          hint="迁移期间保留：已发布快照仍保存这段整篇笔记，页面优先渲染上面的结构字段。"
        >
          <MarkdownEditor
            id="production-description"
            label="旧版发布简介"
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

function AssetRulesPopover({ label, rules }: { label: string; rules: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="studio-info-trigger" aria-label={label}>
          <CircleHelp size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="studio-asset-rules" align="start">
        <p>{rules}</p>
      </PopoverContent>
    </Popover>
  );
}

function AssetMetadataPopover({
  asset,
  scriptVersion,
}: {
  asset: NonNullable<Production['assets']['audio']>;
  scriptVersion: number;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="studio-info-trigger" aria-label="原件信息">
          <CircleHelp size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="studio-asset-meta" align="start">
        <p>
          逐字稿 v{asset.scriptVersion}
          {asset.scriptVersion !== scriptVersion ? ' · 与当前稿不一致' : ''}
        </p>
        <p>
          {(asset.size / 1024 / 1024).toFixed(2)} MB · {asset.mimeType}
        </p>
        <p>{new Date(asset.createdAt).toLocaleString('zh-CN')}</p>
        <code className="studio-wrap studio-asset-meta-key">{asset.key}</code>
      </PopoverContent>
    </Popover>
  );
}

function CoverPreview({ production, categoryName }: { production: Production; categoryName: string }) {
  const cover = production.assets.cover;
  return cover ? (
    <div className="studio-asset-preview studio-asset-preview-cover">
      <FramedCover
        className="studio-cover"
        src={cover.url}
        title={production.title}
        episodeNumber={production.episodeNumber}
        categoryName={categoryName}
        alt={`${production.title}的节目封面`}
      />
      <div className="studio-asset-preview-actions">
        <a
          className="studio-link studio-asset-quiet-link"
          href={cover.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} aria-hidden="true" />
          原图
        </a>
        <CoverDownload
          resource="productions"
          id={production.id}
          version={production.version}
          episodeNumber={production.episodeNumber}
          compact
        />
      </div>
      {cover.scriptVersion !== production.scriptVersion && (
        <p className="studio-notice">这是旧版封面，请上传对应当前逐字稿的成品。</p>
      )}
    </div>
  ) : (
    <p className="admin-muted">尚未上传封面。</p>
  );
}

function AudioPreview({ production, categoryName }: { production: Production; categoryName: string }) {
  const audio = production.assets.audio;
  return audio ? (
    <div className="studio-asset-preview">
      <AudioPlayer
        src={audio.url}
        title={production.title}
        episodeNumber={production.episodeNumber}
        categoryName={categoryName}
        coverUrl={production.assets.cover?.url}
        subtitle={`第 ${production.episodeNumber} 期 · 完整音频`}
        compact
      />
      <div className="studio-asset-preview-meta">
        <span className="admin-muted">
          {Math.round(audio.durationSeconds ?? 0)} 秒{audio.voice ? ` · ${audio.voice}` : ''}
          {audio.includesBumpers ? ' · 含片头与片尾' : ''}
        </span>
        <a
          className="studio-link studio-asset-quiet-link"
          href={audio.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} aria-hidden="true" />
          原件
        </a>
      </div>
      {audio.scriptVersion !== production.scriptVersion && (
        <p className="studio-notice">这是旧版音频，请上传对应当前逐字稿的成品。</p>
      )}
    </div>
  ) : (
    <p className="admin-muted">尚未上传完整音频。</p>
  );
}

export function FinalReview({ production, categoryName }: { production: Production; categoryName: string }) {
  return (
    <div className="studio-stack">
      <div className="studio-grid studio-assets-grid">
        <LayerCard className="studio-asset-card">
          <strong>封面检查</strong>
          <CoverPreview production={production} categoryName={categoryName} />
        </LayerCard>
        <LayerCard className="studio-asset-card">
          <strong>完整试听</strong>
          <AudioPreview production={production} categoryName={categoryName} />
        </LayerCard>
      </div>
      <strong>节目摘要</strong>
      <ReadingText text={production.summary || '摘要尚未准备。'} />
      <strong>发布简介</strong>
      <ReadingText text={production.description || '发布简介尚未准备。'} />
    </div>
  );
}
