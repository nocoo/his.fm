import { Button, Field, Input, LayerCard, toast } from '@nocoo/basalt';
import { FileDropzone } from '@nocoo/basalt/components/file-dropzone';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AgentTokenRecord, ProductionSettings } from '../../shared/production';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { Confirm, CopyButton, Failure } from './controls';
import { agentConnectionInstructions, dateLabel } from './model';
import { productionService } from './service';
import { useUnsavedChanges } from './useUnsavedChanges';
import { VoiceEditor } from './VoiceEditor';

export function StudioSettings() {
  return (
    <div className="admin-page">
      <PageHeader
        title="工作室设置"
        description="设置默认音色、试听讲述风格，管理可选贴片与 Hermes 权限。"
        actions={
          <Button variant="outline" asChild>
            <Link to="/admin/voices">试听音色参考</Link>
          </Button>
        }
      />
      <AudioSettings />
      <TokenSettings />
    </div>
  );
}
function AudioSettings() {
  const [settings, setSettings] = useState<ProductionSettings | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await productionService.settings(signal);
      setSettings(result.settings);
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return (
    <LayerCard padding="none">
      <LayerCard.Header className="studio-row">
        <strong>Gemini 3.8 Flash TTS</strong>
        {settings && (
          <TagBadge
            name={settings.ttsConfigured ? 'Gemini 已配置' : 'Gemini 未配置'}
            color={settings.ttsConfigured ? 'success' : 'amber'}
          />
        )}
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack studio-padding">
        {error && <Failure error={error} retry={!settings ? () => void load() : undefined} />}
        {loading && <LayerCard.Loading label="正在加载声音设置" />}
        {settings && (
          <>
            <p className="admin-muted">
              API 密钥保存在云端，此处仅显示配置状态。默认生成正文音频，无需先上传片头片尾。
            </p>
            <VoiceForm
              settings={settings}
              pending={pending}
              save={async (value) => {
                setPending(true);
                setError('');
                try {
                  const result = await productionService.saveSettings(value);
                  setSettings(result.settings);
                  toast.success('声音设置已保存');
                } catch (cause) {
                  setError(errorMessage(cause));
                } finally {
                  setPending(false);
                }
              }}
            />
            {!settings.ttsConfigured && (
              <p className="studio-notice">尚未配置 Gemini，暂时无法生成声音。请配置云端 GEMINI_API_KEY。</p>
            )}
            <details>
              <summary>可选：片头与片尾贴片</summary>
              <div className="studio-grid">
                {(['intro', 'outro'] as const).map((position) => (
                  <BumperUpload
                    key={position}
                    position={position}
                    value={settings[position]}
                    pending={pending}
                    upload={async (file) => {
                      setPending(true);
                      setError('');
                      try {
                        const result = await productionService.bumper(position, file);
                        setSettings(result.settings);
                        toast.success(`${position === 'intro' ? '片头' : '片尾'}已上传`);
                        return true;
                      } catch (cause) {
                        setError(errorMessage(cause));
                        return false;
                      } finally {
                        setPending(false);
                      }
                    }}
                  />
                ))}
              </div>
            </details>
          </>
        )}
      </LayerCard.Body>
    </LayerCard>
  );
}
function VoiceForm({
  settings,
  pending,
  save,
}: {
  settings: ProductionSettings;
  pending: boolean;
  save: (value: Pick<ProductionSettings, 'voice' | 'speakingStyle'>) => Promise<void>;
}) {
  const [value, setValue] = useState({ voice: settings.voice, speakingStyle: settings.speakingStyle });
  useUnsavedChanges(value.voice !== settings.voice || value.speakingStyle !== settings.speakingStyle);
  return (
    <form
      className="studio-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        await save(value);
      }}
    >
      <VoiceEditor value={value} onChange={setValue} configured={settings.ttsConfigured} disabled={pending} />
      <div className="studio-actions">
        <Button type="submit" loading={pending}>
          保存声音设置
        </Button>
      </div>
    </form>
  );
}

function BumperUpload({
  position,
  value,
  pending,
  upload,
}: {
  position: 'intro' | 'outro';
  value: ProductionSettings['intro'];
  pending: boolean;
  upload: (file: File) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const label = position === 'intro' ? '片头' : '片尾';
  return (
    <LayerCard.Well className="studio-stack studio-padding">
      <strong>{label}</strong>
      {value ? (
        <>
          <audio controls preload="metadata" src={value.url}>
            <track kind="captions" />
          </audio>
          <p className="admin-muted">{value.durationSeconds.toFixed(1)} 秒 · 已配置</p>
        </>
      ) : (
        <p className="admin-muted">尚未上传{label}</p>
      )}
      <FileDropzone
        label={`上传${label}`}
        description="WAV · 24 kHz · 单声道 · 16 位 PCM · 最长 30 秒"
        accept=".wav,audio/wav,audio/x-wav"
        multiple={false}
        maxSize={3 * 1024 * 1024}
        disabled={pending}
        browseLabel={`选择${label}`}
        dropLabel="松开以选择音频"
        formatRejection={() => '请选择 3 MB 以内的 WAV 音频。'}
        onFilesAccepted={([next]) => setFile(next)}
      />
      {file && (
        <div className="studio-row">
          <span className="studio-wrap">{file.name}</span>
          <Button
            loading={pending}
            onClick={async () => {
              if (await upload(file)) setFile(null);
            }}
          >
            上传{label}
          </Button>
        </div>
      )}
    </LayerCard.Well>
  );
}
function TokenSettings() {
  const base = getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin;
  const [tokens, setTokens] = useState<AgentTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState('');
  const [revoking, setRevoking] = useState<AgentTokenRecord | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await productionService.tokens(signal);
      setTokens(result.tokens);
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return (
    <LayerCard padding="none">
      <LayerCard.Header>
        <strong>Hermes 与智能助手</strong>
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack studio-padding">
        <div className="studio-row">
          <p>
            接口地址：<code className="studio-wrap">{base}/api/agent</code>
          </p>
          <CopyButton label="复制接口地址" read={() => `${base}/api/agent`} />
        </div>
        <div className="studio-actions">
          <CopyButton label="复制 Hermes 接入指令" read={() => agentConnectionInstructions(base)} />
          <Button variant="outline" asChild>
            <a href={`${base}/api/agent/instructions`} target="_blank" rel="noopener noreferrer">
              接入说明
            </a>
          </Button>
          <Button variant="ghost" asChild>
            <a href={`${base}/api/agent/openapi.json`} target="_blank" rel="noopener noreferrer">
              OpenAPI
            </a>
          </Button>
        </div>
        <p className="admin-muted">使用当前环境的令牌。入口可公开读取，令牌是否有效请通过 /me 验证。</p>
        <p className="admin-muted">
          令牌允许助手准备内容与生成素材。选题、逐字稿、成品审批和发布确认仍由编辑本人完成。
        </p>
        {error && <Failure error={error} retry={() => void load()} />}
        {token && (
          <LayerCard.Well className="studio-stack studio-padding">
            <strong>新令牌只显示这一次</strong>
            <p className="admin-muted">复制并交给你的助手，离开页面后无法再次查看。</p>
            <InputArea aria-label="新建助手令牌" readOnly value={token} rows={3} />
            <div className="studio-actions">
              <CopyButton label="复制新令牌" read={() => token} />
              <Button variant="ghost" onClick={() => setToken('')}>
                我已保存，隐藏令牌
              </Button>
            </div>
          </LayerCard.Well>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            const form = event.currentTarget;
            const values = new FormData(form);
            setPending(true);
            setError('');
            try {
              const result = await productionService.createToken(
                String(values.get('name')).trim(),
                Number(values.get('expiresInDays')),
              );
              setTokens((current) => [result.record, ...current]);
              setToken(result.token);
              form.reset();
              toast.success('助手令牌已创建');
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setPending(false);
            }
          }}
        >
          <fieldset disabled={pending || Boolean(token)} className="studio-fieldset studio-token-form">
            <Field label="助手名称" htmlFor="token-name" required>
              <Input id="token-name" name="name" required maxLength={100} placeholder="例如：Hermes" />
            </Field>
            <Field label="有效天数" htmlFor="token-days" required>
              <Input
                id="token-days"
                name="expiresInDays"
                type="number"
                min={1}
                max={365}
                defaultValue={30}
                required
              />
            </Field>
            <Button type="submit" loading={pending}>
              创建助手令牌
            </Button>
          </fieldset>
        </form>
        {loading ? (
          <LayerCard.Loading label="正在加载助手令牌" />
        ) : !tokens.length ? (
          <p className="admin-muted">尚未创建助手令牌。</p>
        ) : (
          <ul className="studio-token-list">
            {tokens.map((record) => (
              <li key={record.id}>
                <div>
                  <strong>{record.name}</strong>
                  <p className="admin-muted">
                    {record.prefix}… ·{' '}
                    {record.revokedAt
                      ? `已撤销 ${dateLabel(record.revokedAt)}`
                      : new Date(record.expiresAt) <= new Date()
                        ? '已过期'
                        : `到期 ${dateLabel(record.expiresAt)}`}
                  </p>
                  <p className="admin-muted">
                    创建于 {dateLabel(record.createdAt)} · 最近使用 {dateLabel(record.lastUsedAt)}
                  </p>
                </div>
                {!record.revokedAt && (
                  <Button variant="outline" size="sm" onClick={() => setRevoking(record)}>
                    撤销 {record.name}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {revoking && (
          <Confirm
            title="确认撤销令牌"
            description={`「${revoking.name}」将立即失去访问工作室的权限，撤销后不可恢复。`}
            onClose={() => setRevoking(null)}
            onConfirm={async () => {
              await productionService.revokeToken(revoking.id);
              setTokens(
                tokens.map((record) =>
                  record.id === revoking.id ? { ...record, revokedAt: new Date().toISOString() } : record,
                ),
              );
              setToken('');
              toast.success('令牌已撤销');
            }}
          />
        )}
      </LayerCard.Body>
    </LayerCard>
  );
}
