import { LayerCard } from '@nocoo/basalt';
import { SectionRule } from '@nocoo/basalt/components/section-rule';
import type { ReactNode } from 'react';
import { AudioPlayer } from '../../components/AudioPlayer';
import {
  elevenlabsVoiceCatalog,
  elevenlabsVoicesBeyondComparisons,
  geminiVoiceCatalog,
  geminiVoicesBeyondComparisons,
  referenceVoiceUrl,
  type VoiceProvider,
  voiceComparisonPairs,
  voiceComparisonStyle,
  voiceSampleTranscript,
} from '../../shared/voice-samples';
import { ProviderMark } from './ProviderMark';
import { useReferenceSample } from './useReferenceSample';

function sampleFileName(sampleUrl: string) {
  return sampleUrl.replace(/^.*\//, '').replace(/\.wav$/i, '');
}

function MissingSample({ sampleUrl }: { sampleUrl: string }) {
  const fileName = sampleFileName(sampleUrl);
  return (
    <LayerCard className="appearance-voice-placeholder" padding="md">
      <p className="admin-muted">尚未上传样片（{fileName}）</p>
    </LayerCard>
  );
}

function VoiceSampleCard({
  provider,
  title,
  character,
  model,
  sampleUrl,
  durationSeconds,
}: {
  provider: VoiceProvider;
  title: string;
  character: string;
  model: string;
  sampleUrl: string;
  durationSeconds?: number;
}) {
  const probe = useReferenceSample(sampleUrl);
  return (
    <LayerCard className="appearance-voice-card" data-provider={provider} padding="md">
      <div className="appearance-voice-heading">
        <strong>
          <ProviderMark provider={provider} />
          {title}
        </strong>
        <span className="admin-muted">{character}</span>
      </div>
      <p className="admin-muted">{model}</p>
      {!probe.ready ? (
        <p className="admin-muted">正在检查参考样片…</p>
      ) : probe.available ? (
        <AudioPlayer
          src={sampleUrl}
          title={title}
          subtitle={durationSeconds ? `${durationSeconds.toFixed(2)} 秒 · 固定对比文稿` : '固定对比文稿'}
          compact
          preload="metadata"
        />
      ) : (
        <MissingSample sampleUrl={sampleUrl} />
      )}
    </LayerCard>
  );
}

function ProviderSection({
  provider,
  label,
  model,
  catalogCount,
  listedCount,
  children,
}: {
  provider: VoiceProvider;
  label: string;
  model: string;
  catalogCount: number;
  listedCount: number;
  children: ReactNode;
}) {
  return (
    <section className="appearance-voice-provider-section" data-provider={provider} aria-label={label}>
      <div className="appearance-voice-provider-heading">
        <ProviderMark provider={provider} />
        <h3>{label}</h3>
        <span className="admin-muted">{catalogCount} 个音色</span>
      </div>
      {children}
      {listedCount === 0 ? (
        <p className="admin-muted">
          对比区已包含全部 {label} 参考音色；模型 {model}。
        </p>
      ) : null}
    </section>
  );
}

export function VoicePreviewContent() {
  const geminiBeyond = geminiVoicesBeyondComparisons();
  const elevenlabsBeyond = elevenlabsVoicesBeyondComparisons();

  return (
    <section className="appearance-voices" aria-label="全部音色预览">
      <header className="appearance-voice-intro">
        <h2>全部音色预览（Gemini + ElevenLabs）</h2>
        <p className="admin-muted">
          Gemini 与 ElevenLabs
          的每个音色均使用同一段固定开播文稿与同一种对比风格录制，便于横向试听。本站不托管语音生成；预览样片在站外生成后上传到
          R2 <code>reference/voices/</code>，本页仅播放已上传的 WAV。
        </p>
        <p className="appearance-voice-intro-label">固定文稿</p>
        <p className="studio-prose">{voiceSampleTranscript}</p>
        <p className="appearance-voice-intro-label">对比风格</p>
        <p className="admin-muted">{voiceComparisonStyle}</p>
      </header>

      {voiceComparisonPairs.map((pair) => (
        <SectionRule
          key={pair.id}
          title={pair.label}
          aria-label={pair.label}
          className="appearance-voice-pair"
        >
          <div className="appearance-voice-grid">
            <VoiceSampleCard
              provider="gemini"
              title={`Gemini · ${pair.gemini.name}`}
              character={pair.gemini.character}
              model="gemini-3.8-flash-tts"
              sampleUrl={referenceVoiceUrl(pair.gemini.file)}
              durationSeconds={pair.gemini.durationSeconds}
            />
            <VoiceSampleCard
              provider="elevenlabs"
              title={`ElevenLabs · ${pair.elevenlabs.name}`}
              character={pair.elevenlabs.character}
              model="eleven_v4"
              sampleUrl={referenceVoiceUrl(pair.elevenlabs.file)}
            />
          </div>
        </SectionRule>
      ))}

      <ProviderSection
        provider="gemini"
        label="Gemini"
        model="gemini-3.8-flash-tts"
        catalogCount={geminiVoiceCatalog.length}
        listedCount={geminiBeyond.length}
      >
        <div className="appearance-voice-grid">
          {geminiBeyond.map((sample) => (
            <VoiceSampleCard
              key={sample.voice}
              provider="gemini"
              title={`Gemini · ${sample.voice}`}
              character={sample.character}
              model="gemini-3.8-flash-tts"
              sampleUrl={referenceVoiceUrl(sample.voice)}
              durationSeconds={sample.durationSeconds}
            />
          ))}
        </div>
      </ProviderSection>

      <ProviderSection
        provider="elevenlabs"
        label="ElevenLabs"
        model="eleven_v4"
        catalogCount={elevenlabsVoiceCatalog.length}
        listedCount={elevenlabsBeyond.length}
      >
        <div className="appearance-voice-grid">
          {elevenlabsBeyond.map((sample) => (
            <VoiceSampleCard
              key={sample.file}
              provider="elevenlabs"
              title={`ElevenLabs · ${sample.name}`}
              character={sample.character}
              model="eleven_v4"
              sampleUrl={referenceVoiceUrl(sample.file)}
            />
          ))}
        </div>
      </ProviderSection>
    </section>
  );
}
