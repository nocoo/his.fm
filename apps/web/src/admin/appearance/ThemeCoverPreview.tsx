import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ScrollArea,
} from '@nocoo/basalt';
import { ImageOff, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { FramedCover } from '../../components/FramedCover';
import type { ThemeId } from '../../shared/appearance';
import type { CoverPreviewSource } from './service';

export function ThemeCoverPreview({
  name,
  themeId,
  sources,
  loading,
  sourceError,
}: {
  name: string;
  themeId: ThemeId;
  sources: CoverPreviewSource[];
  loading: boolean;
  sourceError: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  return (
    <div className="appearance-cover-preview">
      <div className="appearance-cover-heading">
        <span className="appearance-detail-label">近期节目</span>
        {sources.length > 0 && <span className="admin-muted">横向滑动 · 点击放大</span>}
      </div>
      {sources.length > 0 ? (
        <ScrollArea
          ref={strip}
          orientation="horizontal"
          type="auto"
          className="appearance-cover-strip"
          aria-label={`${name}近期节目封面`}
        >
          <ul
            className="appearance-cover-list"
            onFocus={(event) => {
              const viewport = strip.current;
              const item = event.target.closest('li');
              if (!viewport || !item) return;
              const bounds = viewport.getBoundingClientRect();
              const cover = item.getBoundingClientRect();
              const inset = Number.parseFloat(getComputedStyle(event.currentTarget).paddingLeft);
              if (cover.left < bounds.left + inset) viewport.scrollLeft += cover.left - bounds.left - inset;
              else if (cover.right > bounds.right - inset)
                viewport.scrollLeft += cover.right - bounds.right + inset;
            }}
          >
            {sources.map((source) => (
              <CoverPreview
                key={`${source.id}:${source.coverUrl}`}
                name={name}
                themeId={themeId}
                source={source}
              />
            ))}
          </ul>
        </ScrollArea>
      ) : (
        <p className="admin-muted appearance-cover-notice">
          {loading
            ? '正在读取节目库…'
            : sourceError
              ? '节目库读取失败，请刷新预览'
              : '节目库暂无可预览的封面'}
        </p>
      )}
    </div>
  );
}

function CoverPreview({
  name,
  themeId,
  source,
}: {
  name: string;
  themeId: ThemeId;
  source: CoverPreviewSource;
}) {
  const [failed, setFailed] = useState(false);
  const cover = {
    src: source.coverUrl,
    title: source.title,
    episodeNumber: source.episodeNumber,
    categoryName: source.categoryName,
    themeId,
    alt: `${source.title} · ${name}封面预览`,
    onCoverError: () => setFailed(true),
  };
  return (
    <li className="appearance-cover-item">
      {!failed ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              className="appearance-cover-open"
              aria-label={`查看${name}封面：${source.title}`}
            >
              <FramedCover {...cover} />
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
              <DialogDescription>{source.title} · 节目库实时叠加预览</DialogDescription>
            </DialogHeader>
            <FramedCover {...cover} />
          </DialogContent>
        </Dialog>
      ) : (
        <div className="appearance-cover-placeholder">
          <ImageOff size={24} strokeWidth={1.5} aria-hidden="true" />
          <span>图片读取失败，请刷新预览</span>
        </div>
      )}
      <div className="appearance-cover-caption">
        <strong title={source.title}>{source.title}</strong>
        <span className="admin-muted">第 {String(source.episodeNumber).padStart(3, '0')} 期</span>
      </div>
    </li>
  );
}
