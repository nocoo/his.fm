import { describe, expect, it } from 'vitest';
import {
  emptyEpisode,
  errorMessage,
  readEpisodeForm,
  sessionDisplayName,
  sessionInitials,
  toLocalDateTime,
} from './model';
import type { Session } from './service';

function validForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    slug: 'a-quiet-evening',
    episodeNumber: '4',
    title: '下班后的留白',
    summary: '给自己一点时间。',
    transcript: '你好，欢迎收听 his.fm。',
    showNotes: '阅读记录',
    coverUrl: 'https://f.no.mt/images/episode-01.webp',
    category: 'manager-notes',
    tags: 'AI， 日常, 休息,,',
    durationMinutes: '10.5',
    audioUrl: '',
    status: 'draft',
    publishedAt: '',
  }))
    form.set(key, value);
  return form;
}

describe('episode form model', () => {
  it('keeps a new episode private with no fabricated audio', () => {
    expect(emptyEpisode.status).toBe('draft');
    expect(emptyEpisode.audioUrl).toBeNull();
    expect(emptyEpisode.publishedAt).toBeNull();
  });
  it('normalizes native form controls into a complete episode', () => {
    const { data, errors } = readEpisodeForm(validForm());
    expect(errors).toBeNull();
    expect(data).toMatchObject({
      episodeNumber: 4,
      durationSeconds: 630,
      tags: ['AI', '日常', '休息'],
      audioUrl: null,
      featured: false,
      publishedAt: null,
    });
  });
  it('converts a supplied publication date and optional media', () => {
    const form = validForm();
    form.set('status', 'published');
    form.set('publishedAt', '2026-09-25T12:30:00+08:00');
    form.set('audioUrl', ' https://cdn.example.com/episode.mp3 ');
    form.set('featured', 'on');
    expect(readEpisodeForm(form).data).toMatchObject({
      publishedAt: '2026-09-25T04:30:00.000Z',
      featured: true,
      audioUrl: 'https://cdn.example.com/episode.mp3',
    });
  });
  it('requires a publication date before publishing', () => {
    const form = validForm();
    form.set('status', 'published');
    expect(readEpisodeForm(form).errors?.publishedAt).toBe('发布前请填写发布时间');
  });
  it('returns field errors for missing values and malformed dates', () => {
    const empty = readEpisodeForm(new FormData());
    expect(empty.data).toBeNull();
    expect(empty.errors).toHaveProperty('title');
    const form = validForm();
    form.set('publishedAt', 'invalid');
    form.set('durationMinutes', 'not-a-number');
    const result = readEpisodeForm(form);
    expect(result.errors).toHaveProperty('publishedAt');
    expect(result.errors).toHaveProperty('durationSeconds');
  });
  it('does not silently accept unsafe media or extra tag capacity', () => {
    const form = validForm();
    form.set('coverUrl', 'javascript:alert(1)');
    form.set('tags', Array.from({ length: 11 }, (_, index) => String(index)).join(','));
    expect(readEpisodeForm(form).errors).toHaveProperty('coverUrl');
    expect(readEpisodeForm(form).errors).toHaveProperty('tags');
  });
  it('represents timestamps in the browser local timezone', () => {
    expect(toLocalDateTime(null)).toBe('');
    const input = '2026-09-25T04:30:00.000Z';
    const local = toLocalDateTime(input);
    expect(new Date(local).getTime()).toBe(new Date(input).getTime());
  });
  it('exposes meaningful errors without stringifying unknown objects', () => {
    expect(errorMessage(new Error('已存在'))).toBe('已存在');
    expect(errorMessage({ secret: true })).toBe('暂时无法完成操作，请稍后重试');
  });
});

describe('session display', () => {
  const session: Session = {
    mode: 'access',
    user: { email: 'editor@his.fm', name: 'Zheng Li', avatar: 'https://img.example/a.png' },
  };

  it('prefers profile name and derives initials', () => {
    expect(sessionDisplayName(session)).toBe('Zheng Li');
    expect(
      sessionDisplayName({
        mode: 'access',
        user: { email: 'editor@his.fm', name: '  ', avatar: null },
      }),
    ).toBe('editor@his.fm');
    expect(sessionInitials('Zheng Li')).toBe('ZL');
    expect(sessionInitials('editor@his.fm')).toBe('ED');
    expect(sessionInitials('')).toBe('?');
    expect(sessionInitials('Solo')).toBe('SO');
  });
});
