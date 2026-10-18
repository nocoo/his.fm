import { describe, expect, it } from 'vitest';
import {
  episodeSocialPreview,
  homepageSocialPreview,
  productionPreviewEpisode,
  socialPlatforms,
} from '../src/admin/seo/social-preview.model';
import { type Episode, projectPublicEpisode } from '../src/shared/episode';
import { withShareArtwork } from '../src/shared/episode-art';
import { siteSeoSchema } from '../src/shared/seo';
import { resolveSiteDefaults } from '../src/shared/seo-resolve';
import { fixture, readyFixture } from './worker/production-fixture';

const origin = 'https://his.fm';
const site = siteSeoSchema.parse({});
const now = Date.parse('2026-10-18T00:00:00Z');
const episode: Episode = {
  ...productionPreviewEpisode(readyFixture()),
  status: 'published',
  publishedAt: '2026-10-17T00:00:00Z',
};

describe('social preview metadata', () => {
  it('shares the exact public episode projection, including label, canonical and share.jpg', async () => {
    const result = await episodeSocialPreview(site, origin, episode, '生活', episode, now);
    expect(result.seo).toEqual(
      (await withShareArtwork(projectPublicEpisode(episode, origin, { site, categoryName: '生活' }), origin))
        .pageSeo,
    );
    expect(result.seo.title).toBe(`生活 EP.08 · ${episode.title} · his.fm`);
    expect(result.seo.description).toBe(`生活 EP.08 · ${episode.summary}`);
    expect(result.seo.canonical).toBe(`${origin}/episodes/life/dinner-before-the-prompt`);
    expect(result.seo.ogImageUrl).toMatch(
      /^https:\/\/his\.fm\/episodes\/production-test\/share\.jpg\?v=[a-f0-9]{64}$/,
    );
    expect(result.imageAvailable).toBe(true);
    expect(result.siteName).toBe(site.siteName);
  });

  it('honors site text overrides and episode overrides without substituting source covers', async () => {
    const customSite = siteSeoSchema.parse({
      siteName: '慢慢来',
      defaultOgImageUrl: 'https://example.com/site.jpg',
      overrides: { title: '全站标题', description: '全站摘要', ogImageUrl: '/brand/override.jpg' },
    });
    const encoded = { ...episode, id: 'record / 中文' };
    const result = await episodeSocialPreview(customSite, origin, encoded, '生活');
    expect(result.seo.title).toBe('全站标题');
    expect(result.seo.description).toBe('全站摘要');
    expect(result.seo.ogImageUrl).toContain(
      `${origin}/episodes/record%20%2F%20%E4%B8%AD%E6%96%87/share.jpg?v=`,
    );
    expect(result.siteName).toBe('慢慢来');
    const overridden = {
      ...episode,
      seo: { title: '本期标题', description: '本期摘要', ogImageUrl: '/media/custom.jpg', noindex: true },
    };
    expect(await episodeSocialPreview(customSite, origin, overridden, '生活', overridden, now)).toMatchObject(
      {
        seo: {
          title: '本期标题',
          description: '本期摘要',
          ogImageUrl: `${origin}/media/custom.jpg`,
          noindex: true,
        },
        imageAvailable: true,
      },
    );
  });

  it('never loads an unpublished, future, invalid-date or unsaved image as live', async () => {
    for (const saved of [
      undefined,
      { ...episode, status: 'draft' as const },
      { ...episode, publishedAt: null },
      { ...episode, publishedAt: 'invalid' },
      { ...episode, publishedAt: '2026-10-19T00:00:00Z' },
      { ...episode, id: 'another-record' },
      { ...episode, coverUrl: '/images/old.jpg' },
      { ...episode, seo: { ogImageUrl: '/images/old.jpg' } },
    ]) {
      expect((await episodeSocialPreview(site, origin, episode, '生活', saved, now)).imageAvailable).toBe(
        false,
      );
    }
    expect((await episodeSocialPreview(site, origin, episode, '生活', episode)).imageAvailable).toBe(true);
    const boundary = { ...episode, publishedAt: new Date(now).toISOString() };
    expect((await episodeSocialPreview(site, origin, boundary, '生活', boundary, now)).imageAvailable).toBe(
      true,
    );
  });

  it('keeps live metadata edits distinct from the saved image without changing inputs', async () => {
    const draft = { ...episode, title: '正在修改', slug: 'new-slug', summary: '新的摘要' };
    const result = await episodeSocialPreview(site, origin, draft, '生活', episode, now);
    expect(result.imageAvailable).toBe(true);
    expect(result.seo.title).toContain('正在修改');
    expect(result.seo.canonical).toContain('/new-slug');
    expect(episode.title).not.toBe(draft.title);
    expect(episode.seo).toEqual({});
  });

  it('uses the homepage resolver and only loads saved image URLs', () => {
    const saved = siteSeoSchema.parse({ defaultOgImageUrl: '' });
    const draft = { ...saved, defaultTitle: '新的首页标题' };
    expect(homepageSocialPreview(draft, saved, origin)).toEqual({
      seo: resolveSiteDefaults(draft, origin),
      siteName: saved.siteName,
      imageAvailable: true,
    });
    expect(homepageSocialPreview(draft, null, origin).imageAvailable).toBe(false);
    expect(
      homepageSocialPreview({ ...draft, defaultOgImageUrl: '/images/new.jpg' }, saved, origin).imageAvailable,
    ).toBe(false);
    const overridden = { ...draft, overrides: { ogImageUrl: '/images/custom.jpg' } };
    expect(homepageSocialPreview(overridden, saved, origin).seo.ogImageUrl).toBe(
      `${origin}/images/custom.jpg`,
    );
  });

  it('maps saved production content without inventing publication or media availability', async () => {
    const draft = productionPreviewEpisode(fixture({ mentions: undefined, seo: undefined }));
    expect(draft).toMatchObject({
      id: 'production-test',
      sourceProductionId: 'production-test',
      coverUrl: '',
      audioUrl: null,
      durationSeconds: 0,
      mentions: [],
      seo: {},
      status: 'draft',
      publishedAt: null,
      featured: false,
    });
    const production = readyFixture({ seo: { title: '制作分享标题' } });
    const ready = productionPreviewEpisode(production);
    expect(ready).toMatchObject({
      seo: production.seo,
      summary: production.summary,
      showNotes: production.description,
      transcript: production.transcript,
      audioUrl: production.assets.audio?.url,
      coverUrl: production.assets.cover?.url,
      durationSeconds: 600,
    });
    expect((await episodeSocialPreview(site, origin, ready, '生活', ready, now)).imageAvailable).toBe(false);
  });

  it('offers all eight requested platform simulations with distinct stable IDs', () => {
    expect(socialPlatforms.map((platform) => platform.id)).toEqual([
      'x',
      'facebook',
      'linkedin',
      'wechat',
      'slack',
      'discord',
      'imessage',
      'telegram',
    ]);
  });
});
