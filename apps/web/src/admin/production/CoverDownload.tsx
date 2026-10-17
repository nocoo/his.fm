import { Button } from '@nocoo/basalt';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useResolvedThemeId } from '../../shared/useResolvedThemeId';
import { errorMessage } from '../model';
import { Failure } from './controls';
import { exportCover } from './cover-export';

export function CoverDownload({
  source,
  episodeNumber,
  compact = false,
}: {
  source: string;
  episodeNumber: number;
  compact?: boolean;
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
      const file = await exportCover(source, episodeNumber, themeId);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `his-fm-ep-${String(episodeNumber).padStart(3, '0')}.png`;
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
    <div className={compact ? undefined : 'studio-stack'}>
      <div className="studio-actions">
        <Button
          variant={compact ? 'ghost' : 'outline'}
          size={compact ? 'icon' : 'sm'}
          loading={pending || themeLoading}
          disabled={!themeResolved || pending || themeLoading}
          aria-label="下载含品牌框架的封面成品"
          onClick={() => void save()}
        >
          <Download size={15} />
          {!compact && ' 下载封面成品'}
        </Button>
        {!compact && <span className="admin-muted">PNG · 1600 × 1600 · 含品牌框架</span>}
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
