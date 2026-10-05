import type { SpeechProvider } from '@his-fm/contracts';
import { Button, LayerCard, toast } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { SectionRule } from '@nocoo/basalt/components/section-rule';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { AudioPreview, ProductionSettings } from '../../shared/production';
import {
  archivedVoiceComparisonStyle,
  voiceComparisonPairs,
  voiceSamples,
  voiceSampleTranscript,
} from '../../shared/voice-samples';
import { errorMessage } from '../model';
import { request } from '../service';
import { Failure } from './controls';
import { ProviderMark } from './ProviderMark';
import { productionService } from './service';

export function VoiceReferences() {
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const [comparisonStyle, setComparisonStyle] = useState('');
  const [settings, setSettings] = useState<ProductionSettings | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<AudioPreview[]>([]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await productionService.settings(signal);
      setSettings(result.settings);
      setComparisonStyle((await productionService.channel(signal)).channel.prompts.voiceComparison);
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
  const play = (audio: HTMLAudioElement) => {
    if (activeAudio.current && activeAudio.current !== audio) activeAudio.current.pause();
    activeAudio.current = audio;
  };
  const select = async (provider: SpeechProvider, voice: string) => {
    setPending(`${provider}:${voice}`);
    setError('');
    try {
      const { config } = await productionService.ai();
      await productionService.saveAi({
        version: config.version,
        settings: {
          ...config.settings,
          defaultProvider: provider,
          [provider]: { ...config.settings[provider], voice },
        },
      });
      setSettings((await productionService.settings()).settings);
      toast.success('默认音色已更新');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };
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
      <p className="admin-muted">
        按音色描述配对，左 Gemini、右
        ElevenLabs；使用共同文稿与当前对比风格。旧样片保留在历史中，修改风格不会自动付费生成，也不改默认音色。
      </p>
      <details>
        <summary>共同文稿与当前对比风格</summary>
        <p className="studio-prose">{voiceSampleTranscript}</p>
        <p className="admin-muted">{comparisonStyle || '正在读取对比风格…'}</p>
        <Link className="studio-link" to="/admin/channel?prompt=voiceComparison">
          编辑音色对比风格
        </Link>
      </details>
      {!settings && !error && (
        <p role="status" className="admin-muted">
          正在读取工作室当前音色…
        </p>
      )}
      {error && <Failure error={error} retry={() => void load()} />}
      {voiceComparisonPairs.map((pair) => (
        <SectionRule key={pair.id} title={pair.label} aria-label={pair.label} className="studio-voice-pair">
          <div className="studio-grid">
            {(['gemini', 'elevenlabs'] as const).map((provider) => {
              const sample = pair[provider];
              const name = `${provider === 'gemini' ? 'Gemini' : 'ElevenLabs'} · ${sample.name}`;
              const key = `${provider}:${sample.voice}`;
              const reference =
                provider === 'gemini' && comparisonStyle === archivedVoiceComparisonStyle
                  ? voiceSamples.find((item) => item.voice === sample.voice)
                  : undefined;
              const preview = reference
                ? {
                    provider,
                    voice: sample.voice,
                    speakingStyle: archivedVoiceComparisonStyle,
                    text: voiceSampleTranscript,
                    url: reference.url,
                    durationSeconds: reference.durationSeconds,
                    cached: true,
                  }
                : previews.find(
                    (item) =>
                      item.provider === provider &&
                      item.voice === sample.voice &&
                      item.text === voiceSampleTranscript &&
                      item.speakingStyle === comparisonStyle,
                  );
              return (
                <ComparisonCard
                  key={key}
                  provider={provider}
                  name={name}
                  character={sample.character}
                  preview={preview}
                  selected={settings?.provider === provider && settings.voice === sample.voice}
                  disabled={pending !== null || !settings || !comparisonStyle}
                  configured={Boolean(settings?.providers[provider])}
                  pending={pending === key}
                  onPlay={play}
                  onSelect={() => select(provider, sample.voice)}
                  onGenerate={async () => {
                    if (!settings) return;
                    setPending(key);
                    setError('');
                    try {
                      const result = await productionService.preview({
                        provider,
                        voice: sample.voice,
                        speakingStyle: comparisonStyle,
                        text: voiceSampleTranscript,
                      });
                      setPreviews((current) => [result.preview, ...current]);
                    } catch (cause) {
                      setError(errorMessage(cause));
                    } finally {
                      setPending(null);
                    }
                  }}
                />
              );
            })}
          </div>
        </SectionRule>
      ))}
      <details className="studio-stack studio-voice-history">
        <summary>历史 Gemini 样片 · 6 段，非本轮配对</summary>
        <div className="studio-grid">
          {voiceSamples.map(({ voice, ...sample }) => (
            <VoiceSample
              key={voice}
              voice={voice}
              {...sample}
              selected={settings?.provider === 'gemini' && settings.voice === voice}
              pending={pending}
              available={Boolean(settings)}
              onPlay={play}
              onSelect={() => select('gemini', voice)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}
function ComparisonCard({
  provider,
  name,
  character,
  preview,
  selected,
  disabled,
  configured,
  pending,
  onPlay,
  onSelect,
  onGenerate,
}: {
  provider: SpeechProvider;
  name: string;
  character: string;
  preview: AudioPreview | undefined;
  selected: boolean;
  disabled: boolean;
  configured: boolean;
  pending: boolean;
  onPlay: (audio: HTMLAudioElement) => void;
  onSelect: () => Promise<void>;
  onGenerate: () => Promise<void>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  return (
    <LayerCard className="studio-stack studio-provider-card studio-voice-card" data-provider={provider}>
      <div className="studio-row">
        <strong className="studio-provider-heading">
          <ProviderMark provider={provider} />
          {name}
        </strong>
        <span className="admin-muted">{character}</span>
      </div>
      <p className="admin-muted">{provider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4'}</p>
      <div className="studio-voice-media">
        {preview ? (
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={preview.url}
            aria-label={`${name} 同文稿试听`}
            onPlay={(event) => {
              setFailed(false);
              onPlay(event.currentTarget);
            }}
            onError={() => setFailed(true)}
          >
            <track kind="captions" />
          </audio>
        ) : (
          <p className="admin-muted">{pending ? '正在生成同文稿样片…' : '尚未生成当前风格的样片'}</p>
        )}
      </div>
      <p className="admin-muted">
        {preview ? `${preview.durationSeconds.toFixed(2)} 秒 · 同文稿` : '同文稿 · 待生成'}
        {selected ? ' · 默认音色' : ''}
      </p>
      <div className="studio-voice-actions">
        {!preview && (
          <Button
            variant="outline"
            size="sm"
            loading={pending}
            disabled={disabled || !configured}
            onClick={() => void onGenerate()}
          >
            生成 {name} 示例
          </Button>
        )}
        {failed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFailed(false);
              audio.current?.load();
            }}
          >
            重试播放 {name}
          </Button>
        )}
        <Button
          variant={selected ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled || selected}
          onClick={() => void onSelect()}
        >
          {selected ? '正在使用此音色' : `使用 ${name}`}
        </Button>
      </div>
    </LayerCard>
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
    <LayerCard padding="none" className="studio-provider-card" data-provider="gemini">
      <LayerCard.Header className="studio-row">
        <strong className="studio-provider-heading">
          <ProviderMark provider="gemini" />
          Gemini · {voice}
        </strong>
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
            loading={pending === `gemini:${voice}`}
            onClick={() => void onSelect()}
          >
            {selected ? '正在使用此音色' : `使用 ${voice} 音色`}
          </Button>
        </div>
      </LayerCard.Body>
    </LayerCard>
  );
}
