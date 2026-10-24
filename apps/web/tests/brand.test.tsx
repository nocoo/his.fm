// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeFavicon } from '../src/brand/ThemeFavicon';
import { themeFaviconPngSrc, themeFaviconSrc } from '../src/brand/themes';
import { themeIds } from '../src/shared/appearance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.head.innerHTML = '';
});

const shell =
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />' +
  '<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicons/stillwood-32.png" />';
describe('theme favicon lifecycle', () => {
  it('switches the vector and bitmap icons for all themes and returns to the saved-theme endpoint on exit', async () => {
    document.head.innerHTML = shell;
    const root = createRoot(document.createElement('div'));
    try {
      for (const theme of themeIds) {
        await act(async () => root.render(<ThemeFavicon theme={theme} />));
        expect(document.querySelector('link[type="image/svg+xml"]')?.getAttribute('href')).toBe(
          themeFaviconSrc(theme),
        );
        expect(document.querySelector('link[type="image/png"]')?.getAttribute('href')).toBe(
          themeFaviconPngSrc(theme),
        );
        expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(2);
      }
    } finally {
      await act(async () => root.unmount());
    }
    expect(document.querySelector('link[type="image/svg+xml"]')?.getAttribute('href')).toBe('/favicon.svg');
    expect(document.querySelector('link[type="image/png"]')).toBeNull();
  });

  it('creates the bitmap icon when the shell only declares the vector icon', async () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(<ThemeFavicon theme="tidal-hours" />));
      expect(document.querySelector('link[type="image/png"]')?.getAttribute('href')).toBe(
        themeFaviconPngSrc('tidal-hours'),
      );
      expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(2);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('does not invent an icon when rendering outside the website document shell', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<ThemeFavicon theme="interval" />));
    await act(async () => root.unmount());
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });
});
