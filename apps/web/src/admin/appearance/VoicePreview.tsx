import { LayerCard } from '@nocoo/basalt';
import { SectionRule } from '@nocoo/basalt/components/section-rule';
import { AudioPlayer } from '../../components/AudioPlayer';
import {
  geminiVoiceCatalog,
  referenceVoiceUrl,
  type VoiceProvider,
  voiceComparisonPairs,
  voiceComparisonStyle,
  voiceSampleTranscript,
} from '../../shared/voice-samples';
import { ProviderMark } from './ProviderMark';
import { useReferenceSample } from './useReferenceSample';

function ComparisonCard({
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
        <LayerCard className="appearance-voice-placeholder" padding="md">
          <p className="admin-muted">尚未上传同文稿样片</p>
          <p className="admin-muted">
            将 WAV 放到 R2 <code>reference/voices/</code> 对应路径（例如{' '}
            <code>{sampleUrl.replace(/^.*\//, '')}</code>
            ）后刷新本页即可试听；清理扫描会保留该前缀。
          </p>
        </LayerCard>
      )}
    </LayerCard>
  );
}

export function VoicePreviewSection() {
  return (
    <section className="appearance-voices" aria-labelledby="appearance-voice-preview-title">
      <div className="appearance-voices-intro">
        <h2 id="appearance-voice-preview-title">音色预览</h2>
        <p className="admin-muted">
          左 Gemini、右 ElevenLabs；使用固定开播文稿与对比风格试听。站点不托管语音生成，仅播放已上传到 R2
          的参考样片。
        </p>
      </div>
      <details className="appearance-voice-script">
        <summary>共同文稿与固定对比风格</summary>
        <p className="studio-prose">{voiceSampleTranscript}</p>
        <p className="admin-muted">{voiceComparisonStyle}</p>
      </details>
      {voiceComparisonPairs.map((pair) => (
        <SectionRule
          key={pair.id}
          title={pair.label}
          aria-label={pair.label}
          className="appearance-voice-pair"
        >
          <div className="appearance-voice-grid">
            <ComparisonCard
              provider="gemini"
              title={`Gemini · ${pair.gemini.name}`}
              character={pair.gemini.character}
              model="gemini-3.8-flash-tts"
              sampleUrl={referenceVoiceUrl(pair.gemini.file)}
              durationSeconds={pair.gemini.durationSeconds}
            />
            <ComparisonCard
              provider="elevenlabs"
              title={`ElevenLabs · ${pair.elevenlabs.name}`}
              character={pair.elevenlabs.character}
              model="eleven_v4"
              sampleUrl={referenceVoiceUrl(pair.elevenlabs.file)}
            />
          </div>
        </SectionRule>
      ))}
      <details className="appearance-voice-history">
        <summary>更多 Gemini 参考样片</summary>
        <div className="appearance-voice-grid">
          {geminiVoiceCatalog.map((sample) => (
            <LayerCard
              key={sample.voice}
              className="appearance-voice-card"
              data-provider="gemini"
              padding="md"
            >
              <div className="appearance-voice-heading">
                <strong>
                  <ProviderMark provider="gemini" />
                  Gemini · {sample.voice}
                </strong>
                <span className="admin-muted">{sample.character}</span>
              </div>
              <AudioPlayer
                src={referenceVoiceUrl(sample.voice)}
                title={`Gemini · ${sample.voice}`}
                subtitle={`${sample.durationSeconds.toFixed(2)} 秒`}
                compact
                preload="none"
              />
            </LayerCard>
          ))}
        </div>
      </details>
    </section>
  );
}
