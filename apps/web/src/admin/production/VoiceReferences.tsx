import { Button, LayerCard, toast } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { AudioPreview, ProductionSettings } from '../../shared/production';
import { elevenVoiceSamples, voiceSamples, voiceSampleTranscript } from '../../shared/voice-samples';
import { errorMessage } from '../model';
import { request } from '../service';
import { Failure } from './controls';
import { productionService } from './service';

export function VoiceReferences() {
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const [settings, setSettings] = useState<ProductionSettings | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<AudioPreview[]>([]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await productionService.settings(signal);
      setSettings(result.settings);
      setPreviews(
        (await request<{ previews: AudioPreview[] }>('/production-settings/previews', { signal })).previews,
      );
      setError('');
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      activeAudio.current?.pause();
    };
  }, [load]);
  return (
    <div className="admin-page">
      <PageHeader
        title="音色参考"
        actions={
          <Button variant="outline" asChild>
            <Link to="/admin/ai">AI 设置</Link>
          </Button>
        }
      />
      <p className="studio-notice">
        两家服务使用完全相同的中文文稿，便于比较声音。生成示例会调用所选服务；相同参数复用已有音频，不改默认音色。
      </p>
      <details>
        <summary>查看共同播报文稿</summary>
        <p className="studio-prose">{voiceSampleTranscript}</p>
      </details>
      {!settings && !error && (
        <p role="status" className="admin-muted">
          正在读取工作室当前音色…
        </p>
      )}
      {error && <Failure error={error} retry={() => void load()} />}
      <div className="studio-grid">
        {[
          { provider: 'gemini' as const, voice: 'Kore', name: 'Gemini · Kore', character: '沉稳坚定' },
          ...elevenVoiceSamples.map((sample) => ({
            ...sample,
            provider: 'elevenlabs' as const,
            name: `ElevenLabs · ${sample.name}`,
          })),
        ].map((sample) => {
          const preview = previews.find(
            (item) =>
              item.provider === sample.provider &&
              item.voice === sample.voice &&
              item.speakingStyle === settings?.speakingStyle,
          );
          return (
            <LayerCard key={`${sample.provider}:${sample.voice}`} className="studio-stack">
              <div className="studio-row">
                <strong>{sample.name}</strong>
                <span className="admin-muted">{sample.character}</span>
              </div>
              <p className="admin-muted">
                {sample.provider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4'}
              </p>
              {preview ? (
                <audio
                  controls
                  preload="none"
                  src={preview.url}
                  aria-label={`${sample.name} 同文稿试听`}
                  onPlay={(event) => {
                    if (activeAudio.current && activeAudio.current !== event.currentTarget)
                      activeAudio.current.pause();
                    activeAudio.current = event.currentTarget;
                  }}
                >
                  <track kind="captions" />
                </audio>
              ) : (
                <p className="admin-muted">尚未生成当前风格的示例</p>
              )}
              {preview && <p className="admin-muted">{preview.durationSeconds.toFixed(2)} 秒 · 同文稿</p>}
              <Button
                variant="outline"
                size="sm"
                loading={pending === sample.voice}
                disabled={pending !== null || !settings?.providers[sample.provider]}
                onClick={async () => {
                  if (!settings) return;
                  setPending(sample.voice);
                  setError('');
                  try {
                    const result = await productionService.preview({
                      provider: sample.provider,
                      voice: sample.voice,
                      speakingStyle: settings.speakingStyle,
                      text: voiceSampleTranscript,
                    });
                    setPreviews((current) => [result.preview, ...current]);
                  } catch (cause) {
                    setError(errorMessage(cause));
                  } finally {
                    setPending(null);
                  }
                }}
              >
                {preview ? '复用同文稿试听' : `生成 ${sample.name} 示例`}
              </Button>
            </LayerCard>
          );
        })}
      </div>
      <p className="admin-muted">Gemini 现有音色样片</p>
      <div className="studio-grid">
        {voiceSamples.map(({ voice, ...sample }) => (
          <VoiceSample
            key={voice}
            voice={voice}
            {...sample}
            selected={settings?.voice === voice}
            pending={pending}
            available={Boolean(settings)}
            onPlay={(audio) => {
              if (activeAudio.current && activeAudio.current !== audio) activeAudio.current.pause();
              activeAudio.current = audio;
            }}
            onSelect={async () => {
              setPending(voice);
              setError('');
              try {
                const { config } = await productionService.ai();
                await productionService.saveAi({
                  version: config.version,
                  settings: {
                    ...config.settings,
                    defaultProvider: 'gemini',
                    gemini: { ...config.settings.gemini, voice },
                  },
                });
                setSettings((await productionService.settings()).settings);
                toast.success(`已将讲述声音设为 ${voice}`);
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setPending(null);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
function VoiceSample({
  voice,
  character,
  durationSeconds,
  url,
  selected,
  pending,
  available,
  onPlay,
  onSelect,
}: {
  voice: ProductionSettings['voice'];
  character: string;
  durationSeconds: number;
  url: string;
  selected: boolean;
  pending: string | null;
  available: boolean;
  onPlay: (audio: HTMLAudioElement) => void;
  onSelect: () => Promise<void>;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <LayerCard padding="none">
      <LayerCard.Header className="studio-row">
        <strong>{voice}</strong>
        <span className="admin-muted">
          {selected ? '工作室当前音色 · ' : ''}
          {character} · {durationSeconds} 秒
        </span>
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack studio-padding">
        <audio
          aria-label={`${voice} 音色样片`}
          ref={audio}
          controls
          preload="none"
          src={url}
          onPlay={(event) => {
            setFailed(false);
            onPlay(event.currentTarget);
          }}
          onError={() => setFailed(true)}
        >
          <track kind="captions" />
        </audio>
        {failed && (
          <Failure
            error="样片暂时无法播放，请重试。"
            retry={() => {
              setFailed(false);
              audio.current?.load();
            }}
          />
        )}
        <div className="studio-actions">
          <Button
            variant={selected ? 'secondary' : 'outline'}
            size="sm"
            disabled={!available || selected || pending !== null}
            loading={pending === voice}
            onClick={() => void onSelect()}
          >
            {selected ? '正在使用此音色' : `使用 ${voice} 音色`}
          </Button>
        </div>
      </LayerCard.Body>
    </LayerCard>
  );
}
