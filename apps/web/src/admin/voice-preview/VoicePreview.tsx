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
import { VoicePreviewBadges } from './VoicePreviewBadges';

function sampleFileName(objectKey: string) {
  return objectKey.split('/').pop() ?? objectKey;
}

function MissingSample({ objectKey }: { objectKey: string }) {
  return (
    <LayerCard className="appearance-voice-placeholder" padding="sm">
      <p className="admin-muted">尚未上传样片（{sampleFileName(objectKey)}）</p>
    </LayerCard>
  );
}

function VoiceSampleCard({ provider, entry }: { provider: VoiceProvider; entry: VoicePreviewEntry }) {
  const sampleUrl = voicePreviewMediaUrl(entry.objectKey);
  const probe = useReferenceSample(sampleUrl);
  const title = provider === 'gemini' ? `Gemini · ${entry.voiceName}` : `ElevenLabs · ${entry.voiceName}`;

  return (
    <LayerCard className="appearance-voice-card" data-provider={provider} padding="sm">
      <div className="appearance-voice-heading">
        <strong>
          <ProviderMark provider={provider} />
          {title}
        </strong>
      </div>
      <VoicePreviewBadges entry={entry} />
      <p className="admin-muted appearance-voice-model">{entry.model}</p>
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

function ComparisonSlot({ provider, entry }: { provider: VoiceProvider; entry?: VoicePreviewEntry }) {
  if (!entry) {
    return <div className="appearance-voice-slot-empty" aria-hidden="true" />;
  }
  return <VoiceSampleCard provider={provider} entry={entry} />;
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
            <ComparisonSlot provider="gemini" entry={row.gemini} />
            <ComparisonSlot provider="elevenlabs" entry={row.elevenlabs} />
          </div>
        ))}
      </div>
    </section>
  );
}
