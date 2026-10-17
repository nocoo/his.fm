// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../../src/admin/AdminRoutes';
import { SiteAppearance } from '../../src/public/Appearance';
import { NotFound } from '../../src/public/PublicRoutes';
import { PublicSiteSeoProvider } from '../../src/public/usePublicSiteSeo';

describe('public shell JSON-LD hygiene', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function mountStaleJsonLd() {
    const stale = document.createElement('script');
    stale.type = 'application/ld+json';
    stale.text = '{"@type":"PodcastEpisode"}';
    document.head.appendChild(stale);
    expect(document.querySelectorAll('script[type="application/ld+json"]').length).toBe(1);
  }

  it('clears stale JSON-LD when the login shell mounts', async () => {
    mountStaleJsonLd();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>,
      );
    });
    expect(document.querySelectorAll('script[type="application/ld+json"]').length).toBe(0);
  });

  it('clears stale JSON-LD when the not-found shell mounts without adding a graph', async () => {
    mountStaleJsonLd();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/missing-route?theme=interval']}>
          <PublicSiteSeoProvider>
            <SiteAppearance>
              <NotFound />
            </SiteAppearance>
          </PublicSiteSeoProvider>
        </MemoryRouter>,
      );
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('script[type="application/ld+json"]').length).toBe(0);
    });
    expect(document.querySelector('script#page-jsonld')).toBeNull();
  });
});
