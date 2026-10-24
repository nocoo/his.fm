import { useLayoutEffect } from 'react';
import type { ThemeId } from '../shared/appearance';
import { themeFaviconPngSrc, themeFaviconSrc } from './themes';

export function ThemeFavicon({ theme }: { theme: ThemeId }) {
  useLayoutEffect(() => {
    const vector = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (!vector) return;
    vector.setAttribute('href', themeFaviconSrc(theme));
    let bitmap = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/png"]');
    if (!bitmap) {
      bitmap = document.createElement('link');
      bitmap.rel = 'icon';
      bitmap.type = 'image/png';
      bitmap.setAttribute('sizes', '32x32');
      vector.insertAdjacentElement('afterend', bitmap);
    }
    bitmap.setAttribute('href', themeFaviconPngSrc(theme));
    return () => {
      vector.setAttribute('href', '/favicon.svg');
      document.querySelector('link[rel="icon"][type="image/png"]')?.remove();
    };
  }, [theme]);
  return null;
}
