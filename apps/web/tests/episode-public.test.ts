import { describe, expect, it } from 'vitest';
import { type Episode, projectPublicEpisode, projectPublicEpisodeSummary } from '../src/shared/episode';

const origin = 'https://hisfm.dev.hexly.ai';

const episode: Episode = {
  id: 'ep-1',
  version: 2,
  slug: 'sample-episode',
  episodeNumber: 3,
  title: '示例节目',
  summary: '公开摘要',
  transcript: '这是不应出现在公开端的完整逐字稿正文。',
  lead: '',
  researchNote: '',
  credits: '',
  body: '',
  topics: [],
  coverUrl: '/images/episode-01.webp',
  category: 'learning',
  tags: ['示例'],
  mentions: [],
  seo: {},
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
    const publicEpisode = projectPublicEpisode(episode, origin);
    expect(publicEpisode).toMatchObject({
      id: episode.id,
      slug: episode.slug,
      title: episode.title,
      summary: episode.summary,
      lead: '',
      researchNote: '',
      credits: '',
      body: '',
      topics: [],
    });
    expect(publicEpisode).not.toHaveProperty('transcript');
    expect(JSON.stringify(publicEpisode)).not.toContain('逐字稿');
  });

  it('keeps the catalogue projection free of bodies, sources and resolved SEO', () => {
    const summary = projectPublicEpisodeSummary({
      ...episode,
      mentions: [{ name: 'his.fm', description: '主站', url: 'https://his.fm/' }],
    });
    expect(summary).toEqual({
      id: episode.id,
      version: episode.version,
      slug: episode.slug,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      summary: episode.summary,
      coverUrl: episode.coverUrl,
      category: episode.category,
      tags: episode.tags,
      durationSeconds: episode.durationSeconds,
      audioUrl: episode.audioUrl,
      featured: episode.featured,
      publishedAt: episode.publishedAt,
    });
    expect(JSON.stringify(summary)).not.toContain('节目备注');
  });
});
