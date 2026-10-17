import { describe, expect, it } from 'vitest';
import type { PublicEpisode } from '../../src/shared/episode';
import { siteSeoSchema } from '../../src/shared/seo';
import {
  breadcrumbJsonLd,
  podcastAuthorJsonLd,
  podcastEpisodeJsonLd,
  podcastSeriesJsonLd,
} from '../../src/shared/seo-jsonld';

describe('seo-jsonld', () => {
  it('uses the configured author identity without inventing a person', () => {
    expect(podcastSeriesJsonLd('https://his.fm', siteSeoSchema.parse({})).author).toEqual({
      '@type': 'Organization',
      name: 'his.fm',
    });
    expect(
      podcastSeriesJsonLd(
        'https://his.fm',
        siteSeoSchema.parse({
          podcastAuthor: 'A named host',
          podcastAuthorType: 'Person',
          podcastAuthorUrl: 'https://author.example.test',
        }),
      ).author,
    ).toEqual({ '@type': 'Person', name: 'A named host', url: 'https://author.example.test' });
  });
  it('builds podcast series and breadcrumb graphs', () => {
    const site = siteSeoSchema.parse({});
    expect(podcastSeriesJsonLd('https://his.fm', site)).toMatchObject({
      '@type': 'PodcastSeries',
      url: 'https://his.fm/',
    });
    expect(breadcrumbJsonLd('https://his.fm', [{ name: '首页', path: '/' }])).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [{ position: 1, name: '首页' }],
    });
    const episode = {
      id: '1',
      version: 1,
      category: 'manager-notes',
      slug: 'note',
      episodeNumber: 1,
      title: 't',
      summary: 's',
      showNotes: '',
      coverUrl: '/images/episode-01.webp',
      tags: [],
      mentions: [],
      durationSeconds: 1,
      audioUrl: null,
      status: 'published',
      featured: false,
      publishedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '',
      updatedAt: '2026-01-01T00:00:00.000Z',
      canonical: 'https://his.fm/episodes/manager-notes/note',
      pageSeo: {
        title: 't',
        description: 's',
        canonical: 'https://his.fm/episodes/manager-notes/note',
        ogImageUrl: 'https://his.fm/images/episode-01.webp',
        noindex: false,
        ogType: 'article' as const,
      },
    } satisfies PublicEpisode;
    expect(podcastEpisodeJsonLd('https://his.fm', episode, site, 'https://f.no.mt/a.mp3')).toMatchObject({
      associatedMedia: { contentUrl: 'https://f.no.mt/a.mp3' },
      author: { '@type': 'Organization', name: 'his.fm' },
    });
    expect(podcastEpisodeJsonLd('https://his.fm', episode, site)).not.toHaveProperty('associatedMedia');
    expect(
      podcastEpisodeJsonLd(
        'https://his.fm',
        episode,
        siteSeoSchema.parse({
          podcastAuthor: 'A named host',
          podcastAuthorType: 'Person',
          podcastAuthorUrl: 'https://author.example.test',
        }),
      ).author,
    ).toEqual({ '@type': 'Person', name: 'A named host', url: 'https://author.example.test' });
    expect(podcastAuthorJsonLd(siteSeoSchema.parse({}))).toEqual({
      '@type': 'Organization',
      name: 'his.fm',
    });
    const withMentions = {
      ...episode,
      mentions: [{ name: '散步', description: '没有链接也可以。' }],
    };
    expect(podcastEpisodeJsonLd('https://his.fm', withMentions, site).mentions).toHaveLength(1);
    const draftTiming = {
      ...episode,
      publishedAt: null,
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    expect(podcastEpisodeJsonLd('https://his.fm', draftTiming, site).datePublished).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });
});
