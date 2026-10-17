import { type ImgHTMLAttributes, useState } from 'react';
import { themeCoverFrameSrc } from '../brand/themes';
import type { ThemeId } from '../shared/appearance';
import { useResolvedThemeId } from '../shared/useResolvedThemeId';
import './FramedCover.css';

export type FramedCoverProps = {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  themeId?: ThemeId;
  onCoverError?: () => void;
} & Pick<ImgHTMLAttributes<HTMLImageElement>, 'loading' | 'width' | 'height' | 'draggable'>;

export function FramedCover({
  src,
  alt = '',
  className = '',
  imageClassName = '',
  themeId,
  onCoverError,
  loading,
  width,
  height,
  draggable,
}: FramedCoverProps) {
  const resolvedTheme = useResolvedThemeId(themeId);
  const frameSrc = themeCoverFrameSrc(resolvedTheme);
  const [failedFrame, setFailedFrame] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const frameFailed = failedFrame === frameSrc;

  if (coverFailed) return null;

  return (
    <div className={`framed-cover ${className}`.trim()}>
      <img
        className={`framed-cover-image ${imageClassName}`.trim()}
        src={src}
        alt={alt}
        loading={loading}
        width={width}
        height={height}
        draggable={draggable}
        onError={() => {
          setCoverFailed(true);
          onCoverError?.();
        }}
      />
      {!frameFailed && (
        <img
          className="framed-cover-overlay"
          src={frameSrc}
          alt=""
          aria-hidden="true"
          onError={() => setFailedFrame(frameSrc)}
        />
      )}
    </div>
  );
}
