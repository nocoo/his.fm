import { Button, Field, Input, LayerCard, toast } from '@nocoo/basalt';
import { FileDropzone } from '@nocoo/basalt/components/file-dropzone';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { useEffect, useState } from 'react';
import { AudioPlayer } from '../../components/AudioPlayer';
import type { BumperRecord } from '../../shared/production';
import { errorMessage } from '../model';
import { request } from '../service';
import { Choice, Failure } from './controls';
import { useUnsavedChanges } from './useUnsavedChanges';

export function BumpersPage() {
  const [bumpers, setBumpers] = useState<BumperRecord[]>([]);
  const [name, setName] = useState('');
  const [position, setPosition] = useState('intro');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useUnsavedChanges(Boolean(name || file));
  useEffect(() => {
    const controller = new AbortController();
    void request<{ bumpers: BumperRecord[] }>('/bumpers', { signal: controller.signal })
      .then((result) => setBumpers(result.bumpers))
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="admin-page">
      <PageHeader title="贴片库" />
      <p className="admin-muted">维护多套片头与片尾，制作节目时分别选择组合。正文默认不附加贴片。</p>
      {error && <Failure error={error} />}
      <form
        className="studio-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!file) return;
          setPending(true);
          setError('');
          try {
            const result = await request<{ bumper: BumperRecord }>(
              `/bumpers?${new URLSearchParams({ name, position })}`,
              { method: 'POST', body: file, headers: { 'Content-Type': 'audio/wav' } },
            );
            setBumpers([...bumpers, result.bumper]);
            setName('');
            setFile(null);
            toast.success('贴片已加入素材库');
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="studio-grid">
          <Field label="贴片名称" htmlFor="bumper-name">
            <Input
              id="bumper-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              disabled={pending}
            />
          </Field>
          <Field label="位置">
            <Choice
              label="位置"
              value={position}
              onChange={setPosition}
              options={[
                { value: 'intro', label: '片头' },
                { value: 'outro', label: '片尾' },
              ]}
              disabled={pending}
            />
          </Field>
        </div>
        <FileDropzone
          label="上传贴片"
          description="WAV · 24 kHz · 单声道 · 16-bit PCM · 最长 30 秒"
          accept=".wav,audio/wav"
          maxSize={3 * 1024 * 1024}
          multiple={false}
          disabled={pending}
          browseLabel="选择贴片"
          onFilesAccepted={([next]) => setFile(next)}
        />
        <div className="studio-row">
          {file && <span>{file.name}</span>}
          <Button type="submit" loading={pending} disabled={!file || !name.trim()}>
            加入贴片库
          </Button>
        </div>
      </form>
      <div className="studio-grid">
        {bumpers.map((item) => (
          <LayerCard key={item.id} className="studio-stack">
            <div className="studio-row">
              <strong>{item.name}</strong>
              <span className="admin-muted">
                {item.position === 'intro' ? '片头' : '片尾'} · {item.durationSeconds.toFixed(1)} 秒
              </span>
            </div>
            <AudioPlayer src={item.url} title={item.name} preload="none" compact />
          </LayerCard>
        ))}
      </div>
    </div>
  );
}
