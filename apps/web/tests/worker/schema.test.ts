import { describe, expect, it } from 'vitest';
import { episodeInputSchema } from '../../src/shared/episode';

const draft = {
  slug: 'a-working-draft',
  episodeNumber: 1,
  title: '下班之后',
  summary: '从一顿晚饭开始。',
  transcript: '',
  showNotes: '',
  coverUrl: '/images/episode-01.webp',
  category: 'life',
  tags: ['日常'],
  durationSeconds: 0,
  audioUrl: null,
  status: 'draft',
  featured: false,
  publishedAt: null,
};

describe('episode input boundaries', () => {
  it('supports all categories, valid HTTPS media and nested local keys', () => {
    for (const category of ['work', 'learning', 'life', 'conversations', 'new-category']) {
      expect(episodeInputSchema.parse({ ...draft, category }).category).toBe(category);
    }
    for (const coverUrl of ['https://cdn.example.com/image.webp', '/media/covers/episode-01.webp']) {
      expect(episodeInputSchema.parse({ ...draft, coverUrl }).coverUrl).toBe(coverUrl);
    }
    expect(episodeInputSchema.parse({ ...draft, title: '  先吃饭  ' }).title).toBe('先吃饭');
    expect(
      episodeInputSchema.parse({ ...draft, status: 'published', publishedAt: '2026-09-25T08:00:00+08:00' })
        .status,
    ).toBe('published');
  });

  it('normalizes publication time zones for chronological database comparisons', () => {
    expect(episodeInputSchema.parse({ ...draft, publishedAt: '2026-09-25T08:00:00+08:00' }).publishedAt).toBe(
      '2026-09-25T00:00:00.000Z',
    );
  });

  it('rejects executable, credential-bearing and traversing media URLs', () => {
    for (const coverUrl of [
      'javascript:alert(1)',
      'data:image/svg+xml,invalid',
      'http://cdn.example.com/image.webp',
      '//evil.example/image.webp',
      'https://user:pass@cdn.example.com/image.webp',
      '/images/../secret',
      'invalid',
    ]) {
      expect(episodeInputSchema.safeParse({ ...draft, coverUrl }).success).toBe(false);
    }
  });

  it('rejects unknown fields, unbounded content and invalid catalog values', () => {
    for (const change of [
      { id: 'override' },
      { slug: 'Bad Slug' },
      { episodeNumber: 0 },
      { durationSeconds: -1 },
      { title: ' ' },
      { summary: '' },
      { transcript: 'a'.repeat(100001) },
      { showNotes: 'a'.repeat(20001) },
      { category: 'invalid/category' },
      { tags: Array.from({ length: 11 }, () => 'tag') },
      { status: 'archived' },
      { status: 'published', publishedAt: null },
      { publishedAt: 'not-a-date' },
    ]) {
      expect(episodeInputSchema.safeParse({ ...draft, ...change }).success).toBe(false);
    }
  });
});
