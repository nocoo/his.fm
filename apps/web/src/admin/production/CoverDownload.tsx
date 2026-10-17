import { Button } from '@nocoo/basalt';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useResolvedThemeId } from '../../shared/useResolvedThemeId';
import { errorMessage } from '../model';
import { downloadCover } from '../service';
import { Failure } from './controls';

export function CoverDownload({
  resource,
  id,
  version,
  episodeNumber,
  compact = false,
  disabled = false,
}: {
  resource: 'productions' | 'episodes';
  id: string;
  version: number;
  episodeNumber: number;
  compact?: boolean;
  disabled?: boolean;
}) {
  const {
    themeId,
    loading: themeLoading,
    resolved: themeResolved,
    error: themeError,
    retry,
  } = useResolvedThemeId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState('');
  async function save() {
    if (!themeResolved) return;
    setPending(true);
    setError('');
    setDownload('');
    try {
      const file = await downloadCover(resource, id, version, themeId);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `his-fm-ep-${String(episodeNumber).padStart(3, '0')}-${themeId}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownload('成品已生成，原图保持不变。');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={compact ? undefined : 'studio-stack studio-cover-download'}>
      <div className="studio-actions">
        <Button
          variant={compact ? 'ghost' : 'outline'}
          size={compact ? 'icon' : 'sm'}
          loading={pending || themeLoading}
          disabled={disabled || !themeResolved || pending || themeLoading}
          aria-label="下载含品牌框架的封面成品"
          onClick={() => void save()}
        >
          <Download size={15} />
          {!compact && ' 下载封面成品'}
        </Button>
        {!compact && (
          <span className="admin-muted">
            {disabled ? '先保存改动，再下载成品' : 'PNG · 1600 × 1600 · 当前主题与已保存内容'}
          </span>
        )}
      </div>
      {themeError && <Failure error={themeError} retry={retry} />}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {download && (
        <p className="admin-muted" role="status">
          {download}
        </p>
      )}
    </div>
  );
}
