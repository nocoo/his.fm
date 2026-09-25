import { useMemo } from 'react';
import { formatReading } from '../../shared/publication-format';

export function ReadingText({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => formatReading(text), [text]);
  return (
    <article
      className={`studio-reader ${className}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: formatReading removes raw HTML/images and allows only escaped HTTPS links.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
