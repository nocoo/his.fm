import { describe, expect, it } from 'vitest';
import { type Episode, projectPublicEpisode } from '../src/shared/episode';

const episode: Episode = {
  id: 'ep-1',
  version: 2,
  slug: 'sample-episode',
  episodeNumber: 3,
  title: '示例节目',
  summary: '公开摘要',
  transcript: '这是不应出现在公开端的完整逐字稿正文。',
  showNotes: '节目备注',
  coverUrl: '/images/episode-01.webp',
  category: 'learning',
  tags: ['示例'],
  mentions: [],
  durationSeconds: 600,
  audioUrl: null,
  status: 'published',
  featured: false,
  publishedAt: '2026-09-01T08:00:00.000Z',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

describe('public episode projection', () => {
  it('removes transcript while preserving catalogue fields', () => {
    const publicEpisode = projectPublicEpisode(episode, 'https://his.fm');
    expect(publicEpisode).toMatchObject({
      id: episode.id,
      slug: episode.slug,
      title: episode.title,
      summary: episode.summary,
      showNotes: episode.showNotes,
    });
    expect(publicEpisode).not.toHaveProperty('transcript');
    expect(publicEpisode.canonical).toContain('/episodes/learning/sample-episode');
    expect(JSON.stringify(publicEpisode)).not.toContain('逐字稿');
  });
});
