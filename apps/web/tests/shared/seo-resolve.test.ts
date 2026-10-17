import { describe, expect, it } from 'vitest';
import type { PublicEpisode } from '../../src/shared/episode';
import { siteSeoSchema } from '../../src/shared/seo';
import {
  resolveAboutPageSeo,
  resolveCatalogueSeo,
  resolveEpisodePageSeo,
  resolveSiteDefaults,
} from '../../src/shared/seo-resolve';

describe('seo-resolve', () => {
  it('merges episode overrides into resolved page metadata', () => {
    const site = siteSeoSchema.parse({});
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
      canonical: 'https://his.fm/episodes/manager-notes/test',
      pageSeo: resolveEpisodePageSeo(site, 'https://his.fm', {} as PublicEpisode, '主理人手札 EP.03', {}),
    };
    const resolved = resolveEpisodePageSeo(site, 'https://his.fm', episode, '主理人手札 EP.03', {
      title: '自定义标题',
      noindex: true,
    });
    expect(resolved.title).toBe('自定义标题');
    expect(resolved.noindex).toBe(true);
    expect(resolved.canonical).toBe(episode.canonical);
  });

  it('resolves static catalogue and about pages', () => {
    const site = siteSeoSchema.parse({});
    const origin = 'https://his.fm';
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
});
