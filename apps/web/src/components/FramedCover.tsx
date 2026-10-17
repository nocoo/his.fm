import { type ImgHTMLAttributes, useEffect, useState } from 'react';
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
  const [frameFailed, setFrameFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    setFrameFailed(false);
  }, [frameSrc]);

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
          onError={() => setFrameFailed(true)}
        />
      )}
    </div>
  );
}
