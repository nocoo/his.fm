import { describe, expect, it } from 'vitest';
import {
  categoryPublicPath,
  episodeCanonicalUrl,
  episodePublicPath,
  isReservedEpisodeSegment,
} from '../../src/shared/episode-url';

describe('episode-url', () => {
  it('builds nested public paths and canonical URLs', () => {
    expect(episodePublicPath('manager-notes', 'leave-a-note')).toBe('/episodes/manager-notes/leave-a-note');
    expect(episodeCanonicalUrl('https://his.fm', { category: 'manager-notes', slug: 'leave-a-note' })).toBe(
      'https://his.fm/episodes/manager-notes/leave-a-note',
    );
    expect(categoryPublicPath('manager-notes')).toBe('/episodes?category=manager-notes');
  });

  it('flags reserved single-segment paths', () => {
    expect(isReservedEpisodeSegment('episodes')).toBe(true);
    expect(isReservedEpisodeSegment('about')).toBe(true);
    expect(isReservedEpisodeSegment('player-first')).toBe(false);
  });
});
