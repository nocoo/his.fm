import { describe, expect, it } from 'vitest';
import type { Episode } from '../../src/shared/episode';
import {
  episodeSeoFromRow,
  mergeEpisodeSeo,
  redirect,
  withPublicEpisodeFields,
} from '../../worker/episode-public';

describe('episode-public helpers', () => {
  it('builds redirects and merges seo rows', () => {
    const response = redirect('/episodes/a/b');
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('/episodes/a/b');
    const episode = { category: 'a', slug: 'b' } as Episode;
    expect(mergeEpisodeSeo(episode, '{"title":"t"}').seo).toEqual({ title: 't' });
    expect(episodeSeoFromRow('{}')).toEqual({});
  });

  it('adds canonical URLs to public episodes', () => {
    const episode = {
      id: '1',
      version: 1,
      slug: 'note',
      episodeNumber: 1,
      title: 't',
      summary: 's',
      lead: '',
      researchNote: '',
      credits: '',
      body: '',
      topics: [],
      coverUrl: '/images/episode-01.webp',
      category: 'manager-notes',
      tags: [],
      mentions: [],
      durationSeconds: 1,
      audioUrl: null,
      status: 'published' as const,
      featured: false,
      publishedAt: null,
      createdAt: '',
      updatedAt: '',
      canonical: 'https://his.fm/episodes/manager-notes/note',
      pageSeo: {
        title: 't',
        description: 's',
        canonical: 'https://his.fm/episodes/manager-notes/note',
        ogImageUrl: 'https://his.fm/images/episode-01.webp',
        noindex: false,
        ogType: 'article' as const,
      },
    };
    expect(withPublicEpisodeFields(episode, 'https://his.fm').canonical).toBe(
      'https://his.fm/episodes/manager-notes/note',
    );
  });
});
