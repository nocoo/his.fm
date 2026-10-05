import type { AiStatus, SpeechSettings } from '@his-fm/contracts';
import { Button, Field, Input, LayerCard, toast } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../model';
import { Choice, Failure } from './controls';
import { ProviderMark } from './ProviderMark';
import { productionService } from './service';
import { useUnsavedChanges } from './useUnsavedChanges';
import { VoiceEditor } from './VoiceEditor';

export function AiSettings({ styleOnly = false }: { styleOnly?: boolean }) {
  const [config, setConfig] = useState<AiStatus | null>(null);
  const [value, setValue] = useState<SpeechSettings | null>(null);
  const [keys, setKeys] = useState({ gemini: '', elevenlabs: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useUnsavedChanges(
    Boolean(
      config && (JSON.stringify(config.settings) !== JSON.stringify(value) || keys.gemini || keys.elevenlabs),
    ),
  );
  useEffect(() => {
    const controller = new AbortController();
    void productionService
      .ai(controller.signal)
      .then(({ config }) => {
        setConfig(config);
        setValue(config.settings);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, []);
  return (
    <div className={styleOnly ? 'studio-stack' : 'admin-page'}>
      <PageHeader
        title={styleOnly ? '旁白风格' : 'AI 设置'}
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/voices">音色对比</Link>
          </Button>
        }
      />
      {styleOnly && (
        <p className="admin-muted">
          讲述风格保存在本机配置，由 Local 与 Prod 共用；保存只影响后续任务，已有语音任务保留原快照。
        </p>
      )}
      {error && <Failure error={error} />}
      {!config || !value ? (
        !error && <LayerCard.Loading label="正在读取主控配置" />
      ) : (
        <form
          className="studio-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError('');
            try {
              const credentials = {
                ...(keys.gemini ? { gemini: keys.gemini } : {}),
                ...(keys.elevenlabs ? { elevenlabs: keys.elevenlabs } : {}),
              };
              const result = await productionService.saveAi({
                version: config.version,
                settings: value,
                credentials,
              });
              setConfig(result.config);
              setValue(result.config.settings);
              setKeys({ gemini: '', elevenlabs: '' });
              toast.success('本机配置已保存');
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setPending(false);
            }
          }}
        >
          {!styleOnly && (
            <>
              <p className="admin-muted">
                配置与 Key 保存在主控用户目录。已有 Key 不读取、不回填；留空保持不变。配置由 Local 与 Prod
                主控共用，网站令牌分别管理。
              </p>
              <LayerCard className="studio-stack">
                <strong>主控与执行模型</strong>
                <p>
                  主控 · {config.coordinator.model} · {config.coordinator.thinkingLevel}
                </p>
                <p>
                  执行 · {config.executor.model} · {config.executor.thinkingLevels.join(' / ')}
                </p>
                <p>决策 · {config.decision.model}</p>
              </LayerCard>
              <Field label="默认语音服务">
                <Choice
                  label="默认语音服务"
                  value={value.defaultProvider}
                  onChange={(provider) =>
                    setValue({ ...value, defaultProvider: provider as SpeechSettings['defaultProvider'] })
                  }
                  options={[
                    { value: 'gemini', label: 'Gemini' },
                    { value: 'elevenlabs', label: 'ElevenLabs' },
                  ]}
                  disabled={pending}
                />
              </Field>
              <div className="studio-grid">
                {(['gemini', 'elevenlabs'] as const).map((provider) => (
                  <LayerCard
                    className="studio-stack studio-provider-card"
                    data-provider={provider}
                    key={provider}
                  >
                    <div className="studio-row">
                      <strong className="studio-provider-heading">
                        <ProviderMark provider={provider} />
                        {provider === 'gemini' ? 'Gemini' : 'ElevenLabs'}
                      </strong>
                      <TagBadge
                        name={config.providers[provider] ? 'Key 已配置' : '未配置'}
                        color={config.providers[provider] ? 'success' : 'amber'}
                      />
                    </div>
                    <p>{value[provider].model}</p>
                    <Field label={`${provider} 新 Key`} htmlFor={`${provider}-key`}>
                      <Input
                        id={`${provider}-key`}
                        type="password"
                        autoComplete="new-password"
                        value={keys[provider]}
                        onChange={(event) => setKeys({ ...keys, [provider]: event.target.value })}
                        placeholder="仅输入新 Key，不回填已有值"
                        disabled={pending}
                      />
                    </Field>
                    <Field label={`${provider} 音色 ID`} htmlFor={`${provider}-voice`}>
                      <Input
                        id={`${provider}-voice`}
                        value={value[provider].voice}
                        onChange={(event) =>
                          setValue({
                            ...value,
                            [provider]: { ...value[provider], voice: event.target.value },
                          })
                        }
                        required
                        disabled={pending}
                      />
                    </Field>
                    {provider === 'elevenlabs' && (
                      <>
                        {(['stability', 'similarity'] as const).map((parameter) => (
                          <Field
                            key={parameter}
                            label={parameter === 'stability' ? 'Stability' : 'Similarity'}
                            htmlFor={parameter}
                          >
                            <Input
                              id={parameter}
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              value={value.elevenlabs[parameter]}
                              onChange={(event) =>
                                setValue({
                                  ...value,
                                  elevenlabs: {
                                    ...value.elevenlabs,
                                    [parameter]: Number(event.target.value),
                                  },
                                })
                              }
                              required
                              disabled={pending}
                            />
                          </Field>
                        ))}
                        <p className="admin-muted">
                          Eleven v4 通过 audio tags 表达风格，不支持 Speed、Style 或 SSML。
                        </p>
                      </>
                    )}
                  </LayerCard>
                ))}
              </div>
            </>
          )}
          {styleOnly && (
            <VoiceEditor
              value={{
                provider: value.defaultProvider,
                voice: value[value.defaultProvider].voice,
                speakingStyle: value.speakingStyle,
              }}
              onChange={(next) =>
                setValue({
                  ...value,
                  defaultProvider: next.provider,
                  speakingStyle: next.speakingStyle,
                  [next.provider]: { ...value[next.provider], voice: next.voice },
                })
              }
              configured={config.providers[value.defaultProvider]}
              disabled={pending}
              voices={{ gemini: value.gemini.voice, elevenlabs: value.elevenlabs.voice }}
            />
          )}
          <div className="studio-actions">
            <Button type="submit" loading={pending}>
              保存{styleOnly ? '旁白风格' : 'AI 设置'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
