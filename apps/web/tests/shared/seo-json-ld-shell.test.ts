// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { siteSeoSchema } from '../../src/shared/seo';
import { applyClientSeo, clearClientJsonLd } from '../../src/shared/seo-client';
import { resolveSiteDefaults } from '../../src/shared/seo-resolve';

describe('public shell JSON-LD hygiene', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('matches login and not-found routes that must not leave stale graphs', () => {
    const stale = document.createElement('script');
    stale.type = 'application/ld+json';
    stale.text = '{"@type":"PodcastEpisode"}';
    document.head.appendChild(stale);
    clearClientJsonLd();
    expect(document.querySelectorAll('script[type="application/ld+json"]').length).toBe(0);

    const site = siteSeoSchema.parse({});
    const origin = 'https://his.fm';
    applyClientSeo(resolveSiteDefaults(site, origin));
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});
