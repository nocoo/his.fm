// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyClientSeo } from '../../src/shared/seo-client';
import type { ResolvedPageSeo } from '../../src/shared/seo-resolve';

const seo: ResolvedPageSeo = {
  title: '测试标题',
  description: '测试描述',
  canonical: 'https://his.fm/episodes',
  ogImageUrl: 'https://his.fm/images/episode-01.webp',
  noindex: false,
  ogType: 'website',
};

describe('seo-client', () => {
  beforeEach(() => {
    document.head.innerHTML = '<title>旧标题</title><meta name="description" content="旧描述" />';
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('creates missing canonical, og:type and twitter tags on client navigation', () => {
    applyClientSeo({ ...seo, ogType: 'article' });
    expect(document.title).toBe('测试标题');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(seo.canonical);
    expect(document.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('article');
    expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(seo.title);
    expect(document.querySelector('meta[name="twitter:description"]')?.getAttribute('content')).toBe(
      seo.description,
    );
    expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe(
      seo.ogImageUrl,
    );
    applyClientSeo({ ...seo, ogType: 'music.song', title: '下一页' });
    expect(document.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('music.song');
    expect(document.title).toBe('下一页');
  });
});
