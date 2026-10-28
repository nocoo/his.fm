import { describe, expect, it } from 'vitest';
import { fixture, readyFixture } from '../../../tests/worker/production-fixture';
import {
  canDeleteLibraryEntry,
  canDeleteProduction,
  canDeleteStandaloneEpisode,
  dateLabel,
  emptyBrief,
  finalMissing,
  latestPublication,
  readBrief,
} from './model';

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
const validForm = {
  title: ' 一次真实的对话 ',
  slug: 'a-real-conversation',
  episodeNumber: '7',
  category: 'life',
  durationMinutes: '12',
  intent: '整理自己的工作边界',
  tags: '生活， 工作, ,日常',
};
describe('production brief form', () => {
  it('parses numbers, trims values and accepts HTTPS links and text sources', () => {
    const sources = [
      { id: 'source-1', type: 'url' as const, title: '参考', content: 'https://example.com/article' },
    ];
    expect(readBrief(form(validForm), sources)).toEqual({
      error: '',
      data: {
        ...emptyBrief('life'),
        title: '一次真实的对话',
        slug: 'a-real-conversation',
        episodeNumber: 7,
        category: 'life',
        targetDurationSeconds: 720,
        intent: validForm.intent,
        tags: ['生活', '工作', '日常'],
        sources,
      },
    });
    expect(readBrief(form({ ...validForm, tags: '' }), []).data?.tags).toEqual([]);
  });
  it('rejects missing values, invalid links, excessive lengths and invalid durations without losing input', () => {
    const input = form(validForm);
    expect(
      readBrief(input, [{ id: 'source-1', type: 'url', title: '', content: 'http://example.com' }]).data,
    ).toBeNull();
    expect(input.get('title')).toBe(validForm.title);
    for (const invalid of [
      new FormData(),
      form({ ...validForm, title: '字'.repeat(161) }),
      form({ ...validForm, durationMinutes: '121' }),
      form({ ...validForm, tags: '长'.repeat(31) }),
    ]) {
      const result = readBrief(invalid, []);
      expect(result.data).toBeNull();
      expect(result.error).toContain('HTTPS');
    }
  });
  it('preserves omitted SEO and validates explicitly edited sharing metadata', () => {
    expect(readBrief(form(validForm), []).data).not.toHaveProperty('seo');
    const seo = { title: '分享标题', ogImageUrl: '/media/uploads/share.png' };
    expect(readBrief(form(validForm), [], seo).data?.seo).toEqual(seo);
    expect(readBrief(form(validForm), [], {}).data?.seo).toEqual({});
    expect(readBrief(form(validForm), [], { ogImageUrl: 'javascript:alert(1)' }).data).toBeNull();
  });
});
describe('final review readiness', () => {
  it('shows the latest actual publication separately for each platform', () => {
    const first = {
      platform: 'wechat' as const,
      url: 'https://mp.weixin.qq.com/s/first',
      publishedAt: '2026-09-24T10:00:00Z',
      confirmedAt: '2026-09-25T08:00:00Z',
      confirmedBy: 'editor',
      version: 1,
    };
    const newer = { ...first, publishedAt: '2026-09-25T07:00:00Z', version: 2 };
    const podcast = {
      ...first,
      platform: 'xiaoyuzhou' as const,
      url: 'https://www.xiaoyuzhoufm.com/episode/example',
    };
    expect(latestPublication(fixture(), 'wechat')).toBeNull();
    const production = fixture({ publications: [first, podcast, newer, first] });
    expect(latestPublication(production, 'wechat')).toEqual(newer);
    expect(latestPublication(production, 'xiaoyuzhou')).toEqual(podcast);
  });
  it('requires summaries, topics, current cover and completed audio', () => {
    expect(finalMissing(fixture())).toEqual([
      '摘要',
      '本期听点（至少三条）',
      '当前版本封面',
      '当前版本完整音频',
    ]);
    expect(finalMissing(readyFixture())).toEqual([]);
    expect(finalMissing(readyFixture({ scriptVersion: 2 }))).toEqual(['当前版本封面', '当前版本完整音频']);
    const ready = readyFixture();
    if (!ready.assets.audio) throw new Error('Missing ready fixture assets');
    expect(
      finalMissing(
        readyFixture({
          assets: { cover: ready.assets.cover, audio: { ...ready.assets.audio, durationSeconds: 0 } },
        }),
      ),
    ).toEqual(['当前版本完整音频']);
    for (const durationSeconds of [NaN, Infinity, -1, 7201]) {
      expect(
        finalMissing(
          readyFixture({ assets: { ...ready.assets, audio: { ...ready.assets.audio, durationSeconds } } }),
        ),
      ).toEqual(['当前版本完整音频']);
    }
  });
  it('formats absent timestamps honestly', () => {
    expect(dateLabel(null)).toBe('尚无记录');
    expect(dateLabel('2026-09-25T00:00:00Z')).toContain('2026');
  });
});

describe('program delete policy', () => {
  it('blocks production delete when a snapshot or publication exists', () => {
    const production = readyFixture();
    expect(canDeleteProduction(production)).toBe(true);
    expect(canDeleteProduction(production, { id: 'ep-1' } as never)).toBe(false);
    expect(canDeleteProduction({ ...production, publications: [{} as never] })).toBe(false);
    expect(
      canDeleteProduction({
        ...production,
        publications: [],
        events: [
          {
            id: 'e1',
            at: '2026-01-01',
            actor: { kind: 'human', name: 'a' },
            action: 'withdraw_publication:wechat',
            feedback: '',
          },
        ],
      }),
    ).toBe(false);
  });

  it('matches library rows and standalone episodes', () => {
    const production = readyFixture();
    expect(
      canDeleteLibraryEntry({
        id: 'production:1',
        title: 't',
        episodeNumber: 1,
        category: 'manager-notes',
        summary: '',
        tags: [],
        coverUrl: null,
        audioUrl: null,
        status: 'draft',
        updatedAt: '2026-01-01',
        href: '/admin/productions/1',
        production,
      }),
    ).toBe(true);
    expect(canDeleteStandaloneEpisode({ sourceProductionId: null } as never)).toBe(true);
    expect(canDeleteStandaloneEpisode({ sourceProductionId: 'prod-1' } as never)).toBe(false);
  });
});
