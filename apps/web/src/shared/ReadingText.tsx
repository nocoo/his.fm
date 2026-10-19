import { useId, useMemo } from 'react';
import { formatReading, sanitizeReadingIdPrefix } from './publication-format';

export function ReadingText({ text, className = '' }: { text: string; className?: string }) {
  const idPrefix = sanitizeReadingIdPrefix(useId());
  const html = useMemo(() => formatReading(text, { idPrefix }), [text, idPrefix]);
  return (
    <article
      className={['studio-reader', 'reading-text', className].filter(Boolean).join(' ')}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: formatReading removes raw HTML/images and allows only escaped HTTPS links.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
