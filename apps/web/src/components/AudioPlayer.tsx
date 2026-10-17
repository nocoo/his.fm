import { Button } from '@nocoo/basalt';
import { Slider } from '@nocoo/basalt/components/slider';
import { Headphones, LoaderCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { audioErrorMessage, formatAudioTime } from './AudioPlayer.model';
import { FramedCover } from './FramedCover';
import './AudioPlayer.css';

export type AudioPlayerProps = {
  src: string;
  title?: string;
  coverUrl?: string;
  episodeNumber?: number;
  categoryName?: string;
  subtitle?: string;
  compact?: boolean;
  className?: string;
  preload?: 'none' | 'metadata' | 'auto';
};

let activeAudio: HTMLAudioElement | null = null;
const speeds = [0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer(props: AudioPlayerProps) {
  return <Player key={props.src} {...props} />;
}

function Player({
  src,
  title = '音频',
  coverUrl,
  episodeNumber,
  categoryName,
  subtitle,
  compact = false,
  className = '',
  preload = 'metadata',
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrubbing = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(preload !== 'none');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');
  const [playNotice, setPlayNotice] = useState('');
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      if (activeAudio === audio) activeAudio = null;
    };
  }, []);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    setPlayNotice('');
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch (cause) {
      if (audioRef.current !== audio || (cause instanceof DOMException && cause.name === 'AbortError'))
        return;
      setLoading(false);
      if (audio.error) setError(audioErrorMessage(audio.error.code));
      else setPlayNotice('播放未能开始，请再次点击播放。');
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const next = Math.max(0, Math.min(duration, value));
    audio.currentTime = next;
    setPosition(next);
  }

  function finishSeek() {
    scrubbing.current = false;
    const audio = audioRef.current;
    if (audio) setPosition(audio.currentTime);
  }

  return (
    <section
      className={`his-audio-player ${compact ? 'is-compact' : ''} ${className}`}
      aria-label={`音频播放器：${title}`}
      data-state={error ? 'error' : loading ? 'loading' : playing ? 'playing' : 'paused'}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: Transcripts belong to the surrounding episode or owner-managed asset, not the playback engine. */}
      <audio
        ref={audioRef}
        src={src}
        preload={preload}
        hidden
        onLoadStart={(event) =>
          setLoading(event.currentTarget.preload !== 'none' || !event.currentTarget.paused)
        }
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) && value > 0 ? value : 0);
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) && value > 0 ? value : 0);
        }}
        onCanPlay={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onSeeking={() => setLoading(true)}
        onSeeked={() => {
          setLoading(false);
          if (!scrubbing.current && audioRef.current) setPosition(audioRef.current.currentTime);
        }}
        onPlay={(event) => {
          if (activeAudio && activeAudio !== event.currentTarget) activeAudio.pause();
          activeAudio = event.currentTarget;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          if (!scrubbing.current) setPosition(event.currentTarget.currentTime);
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        onRateChange={(event) => setSpeed(event.currentTarget.playbackRate)}
        onError={(event) => {
          setError(audioErrorMessage(event.currentTarget.error?.code));
          setLoading(false);
          setPlaying(false);
        }}
      />
      {coverUrl && !coverFailed && (
        <FramedCover
          className="his-audio-cover"
          src={coverUrl}
          title={title}
          episodeNumber={episodeNumber}
          categoryName={categoryName}
          alt=""
          draggable={false}
          onCoverError={() => setCoverFailed(true)}
        />
      )}
      <div className="his-audio-body">
        <div className="his-audio-heading">
          <span className="his-audio-kicker">
            <Headphones size={13} aria-hidden="true" /> HIS.FM / LISTEN
          </span>
          <strong className="his-audio-title">{title}</strong>
          {subtitle && <span className="his-audio-subtitle">{subtitle}</span>}
        </div>
        <div className="his-audio-main">
          <Button
            className="his-audio-play"
            variant="default"
            size="icon"
            aria-label={playing ? '暂停' : '播放'}
            title={playing ? '暂停' : '播放'}
            disabled={Boolean(error)}
            onClick={() => void togglePlayback()}
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <div className="his-audio-timeline">
            <Slider
              className="his-audio-seek"
              aria-label="播放进度（秒）"
              value={[position]}
              min={0}
              max={duration || 1}
              step={1}
              disabled={!duration || Boolean(error)}
              onPointerDownCapture={() => {
                scrubbing.current = true;
              }}
              onPointerUpCapture={finishSeek}
              onPointerCancel={finishSeek}
              onLostPointerCapture={finishSeek}
              onValueChange={([value]) => seek(value)}
            />
            <div className="his-audio-times">
              <span>{formatAudioTime(position)}</span>
              <span>{duration ? formatAudioTime(duration) : '—:——'}</span>
            </div>
          </div>
        </div>
        <div className="his-audio-toolbar">
          <div className="his-audio-volume">
            <Button
              className="his-audio-tool"
              variant="ghost"
              size="icon"
              aria-label={muted || volume === 0 ? '取消静音' : '静音'}
              title={muted || volume === 0 ? '取消静音' : '静音'}
              aria-pressed={muted || volume === 0}
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                const nextMuted = !audio.muted && audio.volume !== 0;
                if (audio.volume === 0) audio.volume = 1;
                audio.muted = nextMuted;
                setVolume(audio.volume);
                setMuted(nextMuted);
              }}
            >
              {muted || volume === 0 ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            </Button>
            <Slider
              className="his-audio-volume-slider"
              aria-label="音量（百分比）"
              value={[muted ? 0 : Math.round(volume * 100)]}
              min={0}
              max={100}
              step={1}
              onValueChange={([value]) => {
                const audio = audioRef.current;
                if (!audio) return;
                audio.volume = value / 100;
                audio.muted = false;
                setVolume(audio.volume);
                setMuted(false);
              }}
            />
          </div>
          <span className="his-audio-status" role="status" aria-live="polite">
            {playNotice ||
              (error ? '无法播放' : loading ? '正在加载音频…' : playing ? '正在播放' : '准备好，慢慢听')}
            {loading && !error && <LoaderCircle size={12} aria-hidden="true" />}
          </span>
          <Button
            className="his-audio-tool his-audio-speed"
            variant="ghost"
            size="sm"
            aria-label={`播放速度：${speed} 倍，点击切换`}
            title="切换播放速度：0.75 / 1 / 1.25 / 1.5 / 2 倍"
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              const next = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length];
              audio.playbackRate = next;
              setSpeed(next);
            }}
          >
            {speed}×
          </Button>
        </div>
        {error && (
          <div className="his-audio-error">
            <span role="alert">{error}</span>
            <Button
              variant="outline"
              size="sm"
              className="his-audio-retry"
              onClick={() => {
                setError('');
                setPlayNotice('');
                setLoading(true);
                setPosition(0);
                setDuration(0);
                const audio = audioRef.current;
                if (audio) {
                  audio.preload = 'metadata';
                  audio.load();
                }
              }}
            >
              <RotateCcw size={14} aria-hidden="true" /> 重试
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
