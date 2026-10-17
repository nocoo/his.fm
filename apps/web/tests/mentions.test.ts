import { describe, expect, it } from 'vitest';
import { mentionSchema, mentionsSchema } from '../src/shared/mentions';
import {
  formatMentionHtml,
  formatMentionLine,
  mentionsShowNotesHtml,
  podcastEpisodeMentionsJsonLd,
} from '../src/shared/mentions-format';

describe('mentions schema', () => {
  it('requires name and description and accepts optional https url', () => {
    expect(
      mentionSchema.parse({
        name: 'HowToLiveBetter',
        description: '一本关于生活节奏的开放读物。',
        url: 'https://github.com/eternity4719/HowToLiveBetter',
      }),
    ).toEqual({
      name: 'HowToLiveBetter',
      description: '一本关于生活节奏的开放读物。',
      url: 'https://github.com/eternity4719/HowToLiveBetter',
    });
    expect(mentionSchema.parse({ name: '散步', description: '没有链接也可以只写说明。' })).toEqual({
      name: '散步',
      description: '没有链接也可以只写说明。',
    });
    expect(mentionsSchema.safeParse([{ name: 'A', description: 'B', note: 'old' }]).success).toBe(false);
  });
});

describe('mentions formatting', () => {
  const mention = {
    name: 'his.fm',
    description: '这档播客的主站。',
    url: 'https://his.fm/',
  };

  it('renders public lines and RSS HTML without note fields', () => {
    expect(formatMentionLine({ name: '散步', description: '没有链接也可以。' })).toBe(
      '散步 — 没有链接也可以。',
    );
    expect(formatMentionLine(mention)).toBe('his.fm — 这档播客的主站。 (https://his.fm/)');
    expect(formatMentionHtml(mention)).toContain('his.fm — 这档播客的主站。');
    expect(mentionsShowNotesHtml([mention])).toContain('本期提到');
    expect(podcastEpisodeMentionsJsonLd([mention])).toEqual([
      {
        '@type': 'Thing',
        name: 'his.fm',
        description: '这档播客的主站。',
        url: 'https://his.fm/',
      },
    ]);
  });
});
