import { Button, LayerCard, toast } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ProductionSettings } from '../../shared/production';
import { voiceSamples, voiceSampleTranscript } from '../../shared/voice-samples';
import { errorMessage } from '../model';
import { Failure } from './controls';
import { productionService } from './service';

export function VoiceReferences() {
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const [settings, setSettings] = useState<ProductionSettings | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await productionService.settings(signal);
      setSettings(result.settings);
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
        description="试听六种声音，选择适合这间工作室的讲述方式。"
        actions={
          <Button variant="outline" asChild>
            <Link to="/admin/settings">工作室设置</Link>
          </Button>
        }
      />
      <p className="studio-notice">
        以下是此前制作的约 20 秒播报样片，用于音色比较。完整节目仍需使用已批准的逐字稿单独生成。
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
                const current = await productionService.settings();
                const result = await productionService.saveSettings({
                  voice,
                  speakingStyle: current.settings.speakingStyle,
                });
                setSettings(result.settings);
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
