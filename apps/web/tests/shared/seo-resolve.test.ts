import { describe, expect, it } from 'vitest';
import type { PublicEpisode } from '../../src/shared/episode';
import { siteSeoSchema } from '../../src/shared/seo';
import {
  resolveAboutPageSeo,
  resolveCatalogueSeo,
  resolveEpisodePageSeo,
  resolveSiteDefaults,
} from '../../src/shared/seo-resolve';

const origin = 'https://his.fm';
const episode: PublicEpisode = {
  id: '1',
  version: 1,
  slug: 'test',
  episodeNumber: 3,
  title: '测试节目',
  summary: '摘要',
  showNotes: '',
  coverUrl: '/images/episode-01.webp',
  category: 'manager-notes',
  tags: [],
  mentions: [],
  durationSeconds: 60,
  audioUrl: null,
  status: 'published',
  featured: false,
  publishedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '',
  updatedAt: '',
  canonical: `${origin}/episodes/manager-notes/test`,
  pageSeo: resolveSiteDefaults(siteSeoSchema.parse({}), origin),
};

describe('seo-resolve', () => {
  it('merges episode overrides into resolved page metadata', () => {
    const site = siteSeoSchema.parse({});
    const resolved = resolveEpisodePageSeo(site, origin, episode, '主理人手札 EP.03', {
      title: '自定义标题',
      noindex: true,
    });
    expect(resolved.title).toBe('自定义标题');
    expect(resolved.noindex).toBe(true);
    expect(resolved.canonical).toBe(episode.canonical);
  });

  it('resolves static catalogue and about pages', () => {
    const site = siteSeoSchema.parse({});
    expect(resolveSiteDefaults(site, origin).canonical).toBe(`${origin}/`);
    expect(resolveAboutPageSeo(site, origin).canonical).toBe(`${origin}/about`);
    expect(resolveCatalogueSeo(site, origin).canonical).toBe(`${origin}/episodes`);
    const category = {
      id: 'manager-notes',
      name: '主理人手札',
      icon: 'mic' as const,
      color: 'blue' as const,
      seo: { noindex: true },
    };
    expect(resolveCatalogueSeo(site, origin, category, category.seo).noindex).toBe(true);
  });

  it.each([undefined, '', '/brand/share.jpg', 'https://cdn.example.test/site.jpg'])(
    'uses the configured site image or brand fallback on non-episode pages (%s)',
    (defaultOgImageUrl) => {
      const site = siteSeoSchema.parse({ defaultOgImageUrl });
      const expected = new URL(defaultOgImageUrl || '/brand/share.jpg', origin).href;
      const category = {
        id: 'manager-notes',
        name: '主理人手札',
        icon: 'mic' as const,
        color: 'blue' as const,
        seo: {},
      };
      for (const resolved of [
        resolveSiteDefaults(site, origin),
        resolveAboutPageSeo(site, origin),
        resolveCatalogueSeo(site, origin),
        resolveCatalogueSeo(site, origin, category),
      ]) {
        expect(resolved.ogImageUrl).toBe(expected);
      }
    },
  );

  it('preserves site image overrides on non-episode pages and explicit page overrides', () => {
    const site = siteSeoSchema.parse({
      defaultOgImageUrl: '/images/default.jpg',
      overrides: { ogImageUrl: 'https://cdn.example.test/site.jpg' },
    });
    for (const resolved of [
      resolveSiteDefaults(site, origin),
      resolveAboutPageSeo(site, origin),
      resolveCatalogueSeo(site, origin),
    ]) {
      expect(resolved.ogImageUrl).toBe(site.overrides?.ogImageUrl);
    }
    const override = { ogImageUrl: '/images/page.jpg' };
    expect(resolveAboutPageSeo(site, origin, override).ogImageUrl).toBe(`${origin}/images/page.jpg`);
    expect(resolveCatalogueSeo(site, origin, undefined, override).ogImageUrl).toBe(
      `${origin}/images/page.jpg`,
    );
  });

  it('keeps local HTTP brand asset URLs absolute without doubling the origin', () => {
    const localOrigin = 'http://localhost:7056';
    const site = siteSeoSchema.parse({ defaultOgImageUrl: '' });
    for (const resolved of [
      resolveSiteDefaults(site, localOrigin),
      resolveAboutPageSeo(site, localOrigin),
      resolveCatalogueSeo(site, localOrigin),
    ]) {
      expect(resolved.ogImageUrl).toBe(`${localOrigin}/brand/share.jpg`);
    }
  });

  it.each(['episode-1', 'episode /节目?&"#'])('uses the episode share image for stable id %s', (id) => {
    const site = siteSeoSchema.parse({
      defaultOgImageUrl: 'https://cdn.example.test/default.jpg',
      overrides: { title: 'Site title', ogImageUrl: 'https://cdn.example.test/site.jpg' },
    });
    const resolved = resolveEpisodePageSeo(site, origin, { ...episode, id }, 'EP.03');
    expect(resolved.ogImageUrl).toBe(`${origin}/episodes/${encodeURIComponent(id)}/share.jpg`);
    expect(resolved.ogImageUrl).not.toContain(episode.coverUrl);
    expect(resolved.title).toBe('Site title');
  });

  it('lets only the episode-specific image override replace its share image', () => {
    const site = siteSeoSchema.parse({ overrides: { ogImageUrl: '/images/site.jpg' } });
    const resolved = resolveEpisodePageSeo(site, origin, episode, 'EP.03', {
      ogImageUrl: 'https://cdn.example.test/episode.jpg',
    });
    expect(resolved.ogImageUrl).toBe('https://cdn.example.test/episode.jpg');
    expect(resolveEpisodePageSeo(site, origin, episode, 'EP.03', {}).ogImageUrl).toBe(
      `${origin}/episodes/1/share.jpg`,
    );
  });
});
