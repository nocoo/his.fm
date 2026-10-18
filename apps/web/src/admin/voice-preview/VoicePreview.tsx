import { LayerCard } from '@nocoo/basalt';
import { AudioPlayer } from '../../components/AudioPlayer';
import {
  type VoicePreviewEntry,
  type VoiceProvider,
  voicePreviewCatalog,
  voicePreviewComparisonRows,
  voicePreviewMediaUrl,
  voicePreviewSampleScript,
  voicePreviewStoragePrefix,
} from '../../shared/voice-samples';
import { ProviderMark } from './ProviderMark';
import { useReferenceSample } from './useReferenceSample';

function sampleFileName(objectKey: string) {
  return objectKey.split('/').pop() ?? objectKey;
}

function MissingSample({ objectKey }: { objectKey: string }) {
  return (
    <LayerCard className="appearance-voice-placeholder" padding="md">
      <p className="admin-muted">尚未上传样片（{sampleFileName(objectKey)}）</p>
    </LayerCard>
  );
}

function VoiceSampleCard({
  provider,
  entry,
  model,
}: {
  provider: VoiceProvider;
  entry: VoicePreviewEntry;
  model: string;
}) {
  const sampleUrl = voicePreviewMediaUrl(entry.objectKey);
  const probe = useReferenceSample(sampleUrl);
  const title = provider === 'gemini' ? `Gemini · ${entry.voiceName}` : `ElevenLabs · ${entry.voiceName}`;

  return (
    <LayerCard className="appearance-voice-card" data-provider={provider} padding="md">
      <div className="appearance-voice-heading">
        <strong>
          <ProviderMark provider={provider} />
          {title}
        </strong>
        <span className="admin-muted">{entry.style}</span>
      </div>
      <p className="admin-muted">{model}</p>
      <p className="admin-muted appearance-voice-id">{entry.voiceId}</p>
      {!probe.ready ? (
        <p className="admin-muted">正在检查参考样片…</p>
      ) : probe.available ? (
        <AudioPlayer
          src={probe.playbackUrl}
          title={title}
          subtitle={`${entry.durationSeconds.toFixed(1)} 秒 · 固定对比文稿`}
          compact
          preload="none"
        />
      ) : (
        <MissingSample objectKey={entry.objectKey} />
      )}
    </LayerCard>
  );
}

function ComparisonSlot({
  provider,
  entry,
  model,
}: {
  provider: VoiceProvider;
  entry?: VoicePreviewEntry;
  model: string;
}) {
  if (!entry) {
    return <div className="appearance-voice-slot-empty" aria-hidden="true" />;
  }
  return <VoiceSampleCard provider={provider} entry={entry} model={model} />;
}

export function VoicePreviewContent() {
  const rows = voicePreviewComparisonRows();
  const geminiCount = voicePreviewCatalog('gemini').length;
  const elevenlabsCount = voicePreviewCatalog('elevenlabs').length;

  return (
    <section className="appearance-voices" aria-label="全部音色预览">
      <header className="appearance-voice-intro">
        <h2>全部音色预览（Gemini + ElevenLabs）</h2>
        <p className="admin-muted">
          下方按行对比 Gemini（{geminiCount} 个音色）与 ElevenLabs（{elevenlabsCount}{' '}
          个音色）；每个音色使用同一段固定中文文稿录制，便于横向试听。本站不托管语音生成；预览样片在站外生成后以
          MP3（
          <code>audio/mpeg</code>）上传到 R2 <code>{voicePreviewStoragePrefix}</code>
          ，本页仅播放已上传文件。同一时间只能播放一个样片。
        </p>
        <p className="appearance-voice-intro-label">固定文稿</p>
        <div className="appearance-voice-script studio-prose">{voicePreviewSampleScript}</div>
      </header>

      <div className="appearance-voice-compare-legend" aria-hidden="true">
        <span>
          <ProviderMark provider="gemini" />
          Gemini
        </span>
        <span>
          <ProviderMark provider="elevenlabs" />
          ElevenLabs
        </span>
      </div>

      <div className="appearance-voice-compare-rows">
        {rows.map((row) => (
          <div
            className="appearance-voice-grid appearance-voice-compare-row"
            key={`${row.gemini?.objectKey ?? 'gemini-empty'}-${row.elevenlabs?.objectKey ?? 'elevenlabs-empty'}`}
          >
            <ComparisonSlot provider="gemini" entry={row.gemini} model="gemini-2.5-flash-preview-tts" />
            <ComparisonSlot provider="elevenlabs" entry={row.elevenlabs} model="eleven_v3" />
          </div>
        ))}
      </div>
    </section>
  );
}
