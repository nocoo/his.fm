import { Button } from '@nocoo/basalt';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../model';
import { exportCover } from './cover-export';

export function CoverDownload({ source, episodeNumber }: { source: string; episodeNumber: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState('');
  async function save() {
    setPending(true);
    setError('');
    setDownload('');
    try {
      const file = await exportCover(source, episodeNumber);
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
    <div className="studio-stack">
      <div className="studio-actions">
        <Button variant="outline" size="sm" loading={pending} onClick={() => void save()}>
          <Download size={15} /> 下载封面成品
        </Button>
        <span className="admin-muted">PNG · 1600 × 1600 · 含品牌框架</span>
      </div>
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
