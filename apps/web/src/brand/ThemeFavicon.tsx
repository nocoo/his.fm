import { useLayoutEffect } from 'react';
import type { ThemeId } from '../shared/appearance';
import { themeFaviconSrc } from './themes';

export function ThemeFavicon({ theme }: { theme: ThemeId }) {
  useLayoutEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    icon?.setAttribute('href', themeFaviconSrc(theme));
    return () => {
      icon?.setAttribute('href', '/favicon.svg');
    };
  }, [theme]);
  return null;
}
