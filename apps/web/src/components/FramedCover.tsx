import { type ImgHTMLAttributes, useState } from 'react';
import { themeCoverFrameSrc } from '../brand/themes';
import type { ThemeId } from '../shared/appearance';
import { type CoverCopy, coverArtwork, coverDesignSize, coverText } from '../shared/cover-composition';
import { useResolvedThemeId } from '../shared/useResolvedThemeId';

/** Whether a prior load error should hide the cover for the current `src`. */
export function coverErrorHidesSrc(failedCoverSrc: string | null, src: string): boolean {
  return failedCoverSrc === src;
}

export type FramedCoverProps = {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  themeId?: ThemeId;
  onCoverError?: () => void;
} & CoverCopy &
  Pick<
    ImgHTMLAttributes<HTMLImageElement>,
    'loading' | 'width' | 'height' | 'draggable' | 'srcSet' | 'sizes'
  >;

export function FramedCover({
  src,
  alt = '',
  className = '',
  imageClassName = '',
  themeId,
  title,
  episodeNumber,
  categoryName,
  onCoverError,
  loading,
  width,
  height,
  draggable,
  srcSet,
  sizes,
}: FramedCoverProps) {
  const { themeId: resolvedTheme, resolved: themeResolved } = useResolvedThemeId(themeId);
  const frameSrc = themeResolved ? themeCoverFrameSrc(resolvedTheme) : null;
  const [failedFrame, setFailedFrame] = useState<string | null>(null);
  const [failedCoverSrc, setFailedCoverSrc] = useState<string | null>(null);
  const frameFailed = !frameSrc || failedFrame === frameSrc;
  const coverFailed = coverErrorHidesSrc(failedCoverSrc, src);
  const art = coverArtwork(resolvedTheme);
  const text = coverText(resolvedTheme, { title, episodeNumber, categoryName });

  if (coverFailed) return null;

  return (
    <div
      className={`framed-cover ${className}`.trim()}
      data-cover-theme={themeResolved ? resolvedTheme : undefined}
    >
      <img
        className={`framed-cover-image ${imageClassName}`.trim()}
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        loading={loading}
        width={width}
        height={height}
        draggable={draggable}
        style={
          frameFailed
            ? undefined
            : {
                left: `${(art.x / coverDesignSize) * 100}%`,
                top: `${(art.y / coverDesignSize) * 100}%`,
                width: `${(art.width / coverDesignSize) * 100}%`,
                height: `${(art.height / coverDesignSize) * 100}%`,
              }
        }
        onError={() => {
          setFailedCoverSrc(src);
          onCoverError?.();
        }}
      />
      {frameSrc && !frameFailed && (
        <>
          <img
            className="framed-cover-overlay"
            src={frameSrc}
            alt=""
            aria-hidden="true"
            onError={() => setFailedFrame(frameSrc)}
          />
          <svg
            className="framed-cover-copy"
            viewBox={`0 0 ${coverDesignSize} ${coverDesignSize}`}
            aria-hidden="true"
            focusable="false"
          >
            {text.map((slot) => (
              <text
                key={slot.template}
                x={slot.x}
                y={slot.y}
                fill={slot.fill}
                fontFamily={slot.fontFamily}
                fontWeight={slot.weight}
                fontSize={slot.fontSize}
                letterSpacing={slot.tracking}
              >
                {slot.value}
              </text>
            ))}
          </svg>
        </>
      )}
    </div>
  );
}
