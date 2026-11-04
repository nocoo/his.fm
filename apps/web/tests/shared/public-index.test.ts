import { describe, expect, it } from 'vitest';
import type { Episode } from '../../src/shared/episode';
import { filterIndexableEpisodes, isPublicEpisodeIndexable } from '../../src/shared/public-index';
import { siteSeoSchema } from '../../src/shared/seo';

const origin = 'https://his.fm.test';

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    version: 1,
    sourceProductionId: null,
    slug: 'one',
    episodeNumber: 1,
    title: 'One',
    summary: 'Summary',
    transcript: '',
    lead: '',
    researchNote: '',
    credits: '',
    body: '',
    topics: [],
    mentions: [],
    coverUrl: '/images/episode-01.webp',
    category: 'learning',
    tags: [],
    seo: {},
    durationSeconds: 60,
    audioUrl: '/media/a.mp3',
    status: 'published',
    featured: false,
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('public episode indexability', () => {
  const site = siteSeoSchema.parse({});

  it('requires published records with elapsed publishedAt and no seo noindex', () => {
    expect(isPublicEpisodeIndexable(episode(), origin, site)).toBe(true);
    expect(isPublicEpisodeIndexable(episode({ publishedAt: null }), origin, site)).toBe(false);
    expect(isPublicEpisodeIndexable(episode({ status: 'draft' }), origin, site)).toBe(false);
    expect(isPublicEpisodeIndexable(episode({ publishedAt: '2999-01-01T00:00:00.000Z' }), origin, site)).toBe(
      false,
    );
    expect(isPublicEpisodeIndexable(episode({ seo: { noindex: true } }), origin, site)).toBe(false);
  });

  it('filters lists with the same predicate', () => {
    const list = [
      episode(),
      episode({ id: 'ep-2', slug: 'hidden', seo: { noindex: true } }),
      episode({ id: 'ep-3', slug: 'future', publishedAt: '2999-01-01T00:00:00.000Z' }),
    ];
    expect(filterIndexableEpisodes(list, origin, site).map((item) => item.slug)).toEqual(['one']);
  });
});
