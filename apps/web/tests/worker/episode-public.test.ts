import { describe, expect, it } from 'vitest';
import type { PublicEpisode } from '../../src/shared/episode';
import { redirect, withPublicEpisodeFields } from '../../worker/episode-public';

describe('episode-public helpers', () => {
  it('builds permanent redirects', () => {
    const response = redirect('/episodes/a/b');
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('/episodes/a/b');
  });

  it('adds canonical URLs to public episodes', () => {
    const episode = {
      category: 'manager-notes',
      slug: 'note',
    } as PublicEpisode;
    expect(withPublicEpisodeFields(episode, 'https://his.fm').canonical).toBe(
      'https://his.fm/episodes/manager-notes/note',
    );
  });
});
