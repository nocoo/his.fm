import type { CSSProperties } from 'react';
import { BrandSymbol, Wordmark } from './Brand';

export function BrandLockup({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={`brand-lockup ${className}`.trim()} style={style}>
      <Wordmark />
      <BrandSymbol />
    </span>
  );
}
