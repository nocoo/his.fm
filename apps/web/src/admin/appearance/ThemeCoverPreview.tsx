import { ArrowUpRight, ImageOff } from 'lucide-react';
import { useState } from 'react';
import type { CoverPreviewSource } from './service';
import type { CoverPreview } from './useAppearancePreviews';

export function ThemeCoverPreview({
  name,
  source,
  preview,
  loading,
  sourceError,
}: {
  name: string;
  source?: CoverPreviewSource;
  preview?: CoverPreview;
  loading: boolean;
  sourceError: string;
}) {
  const [failed, setFailed] = useState(false);
  const ready = preview?.status === 'ready' && !failed;
  return (
    <div className="appearance-cover-preview">
      {ready ? (
        <a href={preview.url} target="_blank" rel="noopener noreferrer" aria-label={`查看${name}封面大图`}>
          <img
            src={preview.url}
            alt={`${source?.title} · ${name}封面预览`}
            width={1600}
            height={1600}
            onError={() => setFailed(true)}
          />
          <span>
            查看大图 <ArrowUpRight size={14} />
          </span>
        </a>
      ) : (
        <div className="appearance-cover-placeholder">
          <ImageOff size={24} strokeWidth={1.5} aria-hidden="true" />
          <span>
            {failed
              ? '图片读取失败，请刷新预览'
              : preview?.status === 'error'
                ? preview.message
                : loading
                  ? '正在读取真实节目'
                  : sourceError
                    ? '节目读取失败，请刷新预览'
                    : !source
                      ? '暂无真实封面'
                      : preview?.status === 'loading'
                        ? '正在生成封面'
                        : '等待生成'}
          </span>
        </div>
      )}
      <div className="appearance-cover-caption">
        <span className="appearance-detail-label">真实节目封面</span>
        {source ? (
          <>
            <strong>{source.title}</strong>
            <span className="admin-muted">
              第 {String(source.episodeNumber).padStart(3, '0')} 期 · 已保存 v{source.version}
            </span>
            <p className="admin-muted">同一原图、标题与期号，按本主题实时合成。点击成品可查看完整细节。</p>
          </>
        ) : loading ? (
          <p className="admin-muted">正在读取当前环境已保存封面原图的制作项目。</p>
        ) : sourceError ? (
          <p className="admin-muted">未能读取当前环境的制作项目。请检查连接后刷新预览。</p>
        ) : (
          <p className="admin-muted">请先在节目制作中保存封面原图。这里不使用设计稿样张或演示节目补位。</p>
        )}
      </div>
    </div>
  );
}
