// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeFavicon } from '../src/brand/ThemeFavicon';
import { themeFaviconSrc } from '../src/brand/themes';
import { themeIds } from '../src/shared/appearance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.head.innerHTML = '';
});

describe('theme favicon lifecycle', () => {
  it('switches the existing icon for all themes and returns to the saved-theme endpoint on exit', async () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.svg" />';
    const root = createRoot(document.createElement('div'));
    try {
      for (const theme of themeIds) {
        await act(async () => root.render(<ThemeFavicon theme={theme} />));
        expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(themeFaviconSrc(theme));
        expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
      }
    } finally {
      await act(async () => root.unmount());
    }
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg');
  });

  it('does not invent an icon when rendering outside the website document shell', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<ThemeFavicon theme="interval" />));
    await act(async () => root.unmount());
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });
});
