import { describe, expect, it } from 'vitest';
import type { PublicEpisode } from '../../src/shared/episode';
import { siteSeoSchema } from '../../src/shared/seo';
import { breadcrumbJsonLd, podcastEpisodeJsonLd, podcastSeriesJsonLd } from '../../src/shared/seo-jsonld';

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
        }),
      ).author,
    ).toEqual({ '@type': 'Person', name: 'A named host' });
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
    expect(podcastEpisodeJsonLd('https://his.fm', episode, 'https://f.no.mt/a.mp3')).toMatchObject({
      associatedMedia: { contentUrl: 'https://f.no.mt/a.mp3' },
    });
  });
});
