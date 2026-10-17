import { describe, expect, it } from 'vitest';
import { type Episode, projectPublicEpisode } from '../../src/shared/episode';
import {
  compareLegacyPublishedSlugCandidates,
  pickLegacyPublishedEpisode,
} from '../../src/shared/legacy-episode-slug';

const base: Episode = {
  id: 'a',
  version: 1,
  slug: 'shared-slug',
  episodeNumber: 1,
  title: 'A',
  summary: '',
  transcript: '',
  showNotes: '',
  coverUrl: '/images/episode-01.webp',
  category: 'life',
  tags: [],
  mentions: [],
  durationSeconds: 0,
  audioUrl: null,
  status: 'published',
  featured: false,
  publishedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '',
  updatedAt: '',
  seo: {},
};

describe('legacy published slug resolution', () => {
  it('picks the earliest published episode with a stable id tie-breaker', () => {
    const older = projectPublicEpisode({ ...base, id: 'episode-older', category: 'life' }, 'https://his.fm');
    const newer = projectPublicEpisode(
      {
        ...base,
        id: 'episode-newer',
        category: 'manager-notes',
        publishedAt: '2026-06-01T00:00:00.000Z',
      },
      'https://his.fm',
    );
    expect(pickLegacyPublishedEpisode([newer, older], 'shared-slug')?.id).toBe('episode-older');
    expect(compareLegacyPublishedSlugCandidates(older, newer)).toBeLessThan(0);
    const tieA = projectPublicEpisode(
      { ...base, id: 'episode-b', publishedAt: '2026-01-01T00:00:00.000Z' },
      'https://his.fm',
    );
    const tieB = projectPublicEpisode(
      { ...base, id: 'episode-a', publishedAt: '2026-01-01T00:00:00.000Z' },
      'https://his.fm',
    );
    expect(pickLegacyPublishedEpisode([tieA, tieB], 'shared-slug')?.id).toBe('episode-a');
  });
});
