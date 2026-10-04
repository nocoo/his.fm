import { Button, Field, LayerCard } from '@nocoo/basalt';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Production, ProductionSettings } from '../../shared/production';
import { cleanText } from '../../shared/publication-format';
import { errorMessage } from '../model';
import { Choice, Confirm, Failure } from './controls';
import { audioBusy } from './model';
import { productionService } from './service';
import { VoiceEditor } from './VoiceEditor';

export function AudioGeneration({
  production,
  pending,
  dirty,
  mutate,
}: {
  production: Production;
  pending: boolean;
  dirty: boolean;
  mutate: (operation: () => Promise<{ production: Production }>, message: string) => Promise<boolean>;
}) {
  const [settings, setSettings] = useState<ProductionSettings | null>(null);
  const [options, setOptions] = useState<Pick<
    ProductionSettings,
    'provider' | 'voice' | 'speakingStyle'
  > | null>(null);
  const [introId, setIntroId] = useState<string | null>(null);
  const [outroId, setOutroId] = useState<string | null>(null);
  const includeBumpers = Boolean(introId || outroId);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await productionService.settings(signal);
      setSettings(result.settings);
      setOptions(
        (current) =>
          current ?? {
            provider: result.settings.provider,
            voice: result.settings.voice,
            speakingStyle: result.settings.speakingStyle,
          },
      );
      setError('');
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const busy = audioBusy(production);
  const generate = () =>
    mutate(
      () =>
        productionService.audio(production.id, { version: production.version, ...options, introId, outroId }),
      '已交给本机主控生成音频',
    );
  if (error) return <Failure error={error} retry={() => void load()} />;
  if (!settings || !options) return <LayerCard.Loading label="正在加载音频生成设置" />;
  return (
    <div className="studio-stack">
      {busy ? (
        <p className="admin-muted">
          任务使用开始时选定的音色和讲述风格。可以关闭浏览器，主控保持运行时会继续生成。
        </p>
      ) : (
        <>
          <div className="studio-row">
            <strong>本次生成</strong>
            <Link className="studio-link" to="/admin/narration">
              声音设置
            </Link>
          </div>
          <p className="admin-muted">这里的选择仅用于本次音频；工作室默认声音保持不变。</p>
          <VoiceEditor
            value={options}
            onChange={setOptions}
            configured={settings.providers[options.provider]}
            voices={settings.voices}
            disabled={pending || dirty}
            text={cleanText(production.transcript)}
          />
          <div className="studio-grid">
            {(['intro', 'outro'] as const).map((position) => (
              <Field key={position} label={position === 'intro' ? '片头' : '片尾'}>
                <Choice
                  label={position === 'intro' ? '片头' : '片尾'}
                  value={(position === 'intro' ? introId : outroId) ?? 'none'}
                  onChange={(value) =>
                    (position === 'intro' ? setIntroId : setOutroId)(value === 'none' ? null : value)
                  }
                  disabled={pending}
                  options={[
                    { value: 'none', label: '不添加' },
                    ...settings.bumpers
                      .filter((item) => item.position === position)
                      .map((item) => ({ value: item.id, label: item.name })),
                  ]}
                />
              </Field>
            ))}
          </div>
          {!settings.providers[options.provider] && (
            <p className="studio-notice">尚未配置所选语音服务的本机 Key。</p>
          )}
        </>
      )}
      <div className="studio-actions">
        <Button
          loading={pending}
          disabled={
            dirty ||
            !settings.providers[options.provider] ||
            !production.approvals.script ||
            production.audioJob?.status === 'running' ||
            !options.speakingStyle.trim()
          }
          onClick={() => {
            if (production.assets.audio && !busy) setConfirm(true);
            else void generate();
          }}
        >
          {production.audioJob?.status === 'queued'
            ? '重试派发音频任务'
            : production.audioJob?.status === 'failed'
              ? '重试生成音频'
              : production.assets.audio
                ? '重新生成音频'
                : includeBumpers
                  ? '生成含贴片音频'
                  : '生成正文音频'}
        </Button>
      </div>
      {!production.approvals.script && (
        <p className="admin-muted">先在逐字稿阶段标记完成，再生成正文；短预览可随时试听。</p>
      )}
      {confirm && (
        <Confirm
          title="确认重新生成音频"
          description={`使用 ${options.voice} 重新生成${includeBumpers ? '正文与片头片尾' : '正文音频'}。本次会调用所选语音服务，新音频完成后需要重新检查。`}
          onClose={() => setConfirm(false)}
          onConfirm={generate}
        />
      )}
    </div>
  );
}
