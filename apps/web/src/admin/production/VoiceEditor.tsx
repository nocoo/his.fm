import { Button, Field } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { useId, useState } from 'react';
import type { AudioPreview, ProductionSettings } from '../../shared/production';
import { elevenVoiceSamples, voiceSamples, voiceSampleTranscript } from '../../shared/voice-samples';
import { voiceCharacters, voices } from '../../shared/voices';
import { errorMessage } from '../model';
import { Choice, Failure } from './controls';
import { productionService } from './service';

type VoiceOptions = Pick<ProductionSettings, 'provider' | 'voice' | 'speakingStyle'>;
export const previewScript = voiceSampleTranscript;

export function VoiceEditor({
  value,
  onChange,
  configured,
  disabled = false,
  text = previewScript,
  voices: defaults,
}: {
  value: VoiceOptions;
  onChange: (value: VoiceOptions) => void;
  configured: boolean;
  disabled?: boolean;
  text?: string;
  voices: { gemini: string; elevenlabs: string };
}) {
  const id = useId();
  const [sampleText, setSampleText] = useState(() => Array.from(text).slice(0, 200).join(''));
  const [preview, setPreview] = useState<AudioPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const reference =
    value.provider === 'gemini' && voiceSamples.find((sample) => sample.voice === value.voice);
  const currentPreview =
    preview?.provider === value.provider &&
    preview.voice === value.voice &&
    preview.speakingStyle === value.speakingStyle.trim() &&
    preview.text === sampleText.trim()
      ? preview
      : null;
  return (
    <div
      className="studio-stack"
      onPlayCapture={(event) => {
        for (const audio of event.currentTarget.querySelectorAll('audio'))
          if (audio !== event.target) audio.pause();
      }}
    >
      <Field label="语音服务">
        <Choice
          label="语音服务"
          value={value.provider}
          disabled={disabled || pending}
          onChange={(provider) =>
            onChange({
              ...value,
              provider: provider as VoiceOptions['provider'],
              voice: defaults[provider as VoiceOptions['provider']],
            })
          }
          options={[
            { value: 'gemini', label: 'Gemini' },
            { value: 'elevenlabs', label: 'ElevenLabs · eleven_v4' },
          ]}
        />
      </Field>
      <Field
        label="讲述声音"
        hint={
          value.provider === 'gemini'
            ? 'Google 的 30 种预置音色，均可生成中文。'
            : 'ElevenLabs 的音色在 AI 设置中管理，支持中文。'
        }
      >
        <Choice
          label="讲述声音"
          value={value.voice}
          disabled={disabled || pending}
          onChange={(voice) => onChange({ ...value, voice: voice as VoiceOptions['voice'] })}
          options={
            value.provider === 'gemini'
              ? voices.map((voice) => ({ value: voice, label: `${voice} · ${voiceCharacters[voice]}` }))
              : [
                  { value: defaults.elevenlabs, label: `配置音色 · ${defaults.elevenlabs}` },
                  ...elevenVoiceSamples
                    .filter((sample) => sample.voice !== defaults.elevenlabs)
                    .map((sample) => ({
                      value: sample.voice,
                      label: `${sample.name} · ${sample.character}`,
                    })),
                ]
          }
        />
      </Field>
      {reference && (
        <details>
          <summary>
            试听 {value.voice} 的现有样片 · {reference.durationSeconds} 秒
          </summary>
          <audio
            key={reference.url}
            controls
            preload="none"
            src={reference.url}
            aria-label={`${value.voice} 音色参考`}
          >
            <track kind="captions" />
          </audio>
          <p className="admin-muted">现有样片用于比较音色；下方预览会使用你填写的风格与文字。</p>
        </details>
      )}
      <Field
        label="讲述风格"
        htmlFor={`${id}-style`}
        hint="描述语气、语速和停顿；这些说明不会写进播讲正文。"
        required
      >
        <InputArea
          id={`${id}-style`}
          name="speakingStyle"
          className="studio-autosize"
          value={value.speakingStyle}
          onChange={(event) => onChange({ ...value, speakingStyle: event.target.value })}
          maxLength={2000}
          rows={3}
          required
          disabled={disabled || pending}
        />
      </Field>
      <details className="studio-preview-settings">
        <summary>调整试听文字 · 最多 200 字</summary>
        <Field label="试听文字" htmlFor={`${id}-text`}>
          <InputArea
            id={`${id}-text`}
            className="studio-autosize"
            value={sampleText}
            onChange={(event) => setSampleText(event.target.value)}
            maxLength={200}
            rows={3}
            disabled={disabled || pending}
          />
        </Field>
      </details>
      <div className="studio-row">
        <p className="admin-muted">试听可跳过。生成预览由主控调用所选语音服务；相同内容会复用已有预览。</p>
        <Button
          type="button"
          variant="outline"
          loading={pending}
          disabled={disabled || !configured || !sampleText.trim() || !value.speakingStyle.trim()}
          onClick={async () => {
            setPending(true);
            setError('');
            try {
              setPreview((await productionService.preview({ ...value, text: sampleText })).preview);
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setPending(false);
            }
          }}
        >
          生成试听预览
        </Button>
      </div>
      {pending && (
        <p role="status" className="admin-muted">
          主控已安排专职语音会话，正在本机生成短预览…
        </p>
      )}
      {error && <Failure error={error} />}
      {currentPreview && (
        <div className="studio-stack">
          <audio
            key={currentPreview.url}
            aria-label="本次生成的试听预览"
            controls
            preload="metadata"
            src={currentPreview.url}
          >
            <track kind="captions" />
          </audio>
          <p className="admin-muted">
            {currentPreview.voice} · {currentPreview.durationSeconds.toFixed(1)} 秒
            {currentPreview.cached ? ' · 已复用预览' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
