import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@nocoo/basalt';
import { ArrowUpRight, ImageOff, X } from 'lucide-react';
import { useState } from 'react';
import { FramedCover } from '../../components/FramedCover';
import type { ThemeId } from '../../shared/appearance';
import type { CoverPreviewSource } from './service';

export function ThemeCoverPreview({
  name,
  themeId,
  source,
  loading,
  sourceError,
}: {
  name: string;
  themeId: ThemeId;
  source?: CoverPreviewSource;
  loading: boolean;
  sourceError: string;
}) {
  const [failed, setFailed] = useState(false);
  const cover = source && {
    src: source.coverUrl,
    title: source.title,
    episodeNumber: source.episodeNumber,
    categoryName: source.categoryName,
    themeId,
    alt: `${source.title} · ${name}封面预览`,
    onCoverError: () => setFailed(true),
  };
  return (
    <div className="appearance-cover-preview">
      {cover && !failed ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" className="appearance-cover-open" aria-label={`查看${name}封面大图`}>
              <FramedCover {...cover} />
              <span>
                查看大图 <ArrowUpRight size={14} />
              </span>
            </Button>
          </DialogTrigger>
          <DialogContent className="appearance-cover-dialog">
            <DialogHeader>
              <div className="appearance-cover-dialog-heading">
                <DialogTitle>{name} · 封面预览</DialogTitle>
                <DialogClose asChild>
                  <Button variant="ghost" size="icon" aria-label="关闭封面预览">
                    <X size={16} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                </DialogClose>
              </div>
              <DialogDescription>{source?.title} · 已保存内容的实时叠加预览</DialogDescription>
            </DialogHeader>
            <FramedCover {...cover} />
          </DialogContent>
        </Dialog>
      ) : (
        <div className="appearance-cover-placeholder">
          <ImageOff size={24} strokeWidth={1.5} aria-hidden="true" />
          <span>
            {failed
              ? '图片读取失败，请刷新预览'
              : loading
                ? '正在读取真实节目'
                : sourceError
                  ? '节目读取失败，请刷新预览'
                  : '暂无真实封面'}
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
            <p className="admin-muted">同一原图、标题、期号与栏目，直接叠加本主题构图。点击查看大图。</p>
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
