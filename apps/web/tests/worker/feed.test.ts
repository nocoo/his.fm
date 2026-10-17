import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Episode, projectPublicEpisode } from '../../src/shared/episode';
import { artLocation } from '../../src/shared/episode-art';
import { type SiteSeoRecord, siteSeoSchema } from '../../src/shared/seo';
import { getAppearance } from '../../worker/appearance';
import { artRecords } from '../../worker/episode-art-cache';
import { listEpisodes, listPublishedEpisodesInCategory } from '../../worker/episodes';
import { buildCategoryRssFeed, buildRssFeed } from '../../worker/feed';
import { getSiteSeo } from '../../worker/seo-store';

vi.mock('../../worker/episodes', () => ({
  listEpisodes: vi.fn(),
  listPublishedEpisodesInCategory: vi.fn(),
}));
vi.mock('../../worker/seo-store', () => ({ getSiteSeo: vi.fn() }));
vi.mock('../../worker/appearance', () => ({ getAppearance: vi.fn() }));
vi.mock('../../worker/episode-art-cache', () => ({ artRecords: vi.fn() }));

const origin = 'https://his.fm';
const mediaBase = 'https://f.no.mt';
const db = {} as D1Database;
let site: SiteSeoRecord;

function episode(patch: Partial<Episode> = {}): Episode {
  return {
    id: 'episode-1',
    version: 1,
    slug: 'episode-one',
    episodeNumber: 1,
    title: '第一期',
    summary: '节目简介',
    transcript: 'Private transcript',
    showNotes: '',
    coverUrl: '/images/episode-01.webp',
    category: 'manager-notes',
    tags: [],
    mentions: [],
    seo: {},
    durationSeconds: 123,
    audioUrl: '/media/audio.mp3',
    status: 'published',
    featured: false,
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...patch,
  };
}

function catalogue(...episodes: Episode[]) {
  vi.mocked(artRecords).mockResolvedValue(
    episodes.map((item) => ({ ...item, categoryName: '生活', resource: 'episodes' as const })),
  );
  vi.mocked(listEpisodes).mockResolvedValue(episodes.map((item) => projectPublicEpisode(item, origin)));
  vi.mocked(listPublishedEpisodesInCategory).mockResolvedValue(episodes);
}

function media(size = 12345, contentType: string | undefined = 'audio/mpeg') {
  const head = vi
    .fn<(key: string) => Promise<R2Object | null>>()
    .mockResolvedValue({ size, httpMetadata: { contentType } } as R2Object);
  return { head, bucket: { head } as unknown as R2Bucket };
}

beforeEach(() => {
  vi.resetAllMocks();
  site = {
    ...siteSeoSchema.parse({}),
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'owner',
  };
  vi.mocked(getSiteSeo).mockImplementation(async () => site);
  vi.mocked(getAppearance).mockResolvedValue({
    theme: 'stillwood',
    version: 1,
    updatedAt: '',
    updatedBy: '',
  });
  catalogue(episode());
});

async function artUrl(id = 'episode-1') {
  return (await artLocation({ ...episode({ id }), categoryName: '生活', resource: 'episodes' }, 'stillwood'))
    .url;
}

describe('podcast feeds', () => {
  it.each([false, true])(
    'uses boolean explicit metadata (%s), brand cover fallback and only configured contact',
    async (explicit) => {
      site.itunesExplicit = explicit;
      const { bucket } = media();
      const xml = await buildRssFeed(db, origin, mediaBase, bucket);
      expect(xml).toContain(`<itunes:explicit>${explicit}</itunes:explicit>`);
      expect(xml).toContain('<itunes:image href="https://his.fm/brand/podcast.jpg" />');
      expect(xml).toContain(`<itunes:image href="${origin}${await artUrl()}" />`);
      expect(xml).not.toContain('<itunes:owner');
      expect(xml).not.toContain('<itunes:name');
      expect(xml).not.toContain('<atom:author');
      expect(xml).not.toContain('<atom:uri');
      expect(xml).not.toContain(site.defaultOgImageUrl);
      expect(xml).toContain('<itunes:author>his.fm</itunes:author>');
      expect(xml).toContain('<itunes:category text="Technology" />');
      expect(xml).toContain('<language>zh-CN</language>');
      expect(xml).toContain('<itunes:duration>123</itunes:duration>');
      expect(xml).toContain('<pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>');
      expect(xml).not.toContain('Private transcript');
    },
  );

  it('uses the independent podcast cover and the explicitly configured owner email', async () => {
    site.podcastCoverUrl = '/images/confirmed-cover.png';
    site.podcastOwnerEmail = 'confirmed-owner@example.test';
    site.podcastAuthor = 'Existing producer';
    const xml = await buildRssFeed(db, origin, mediaBase, media().bucket);
    expect(xml).toContain('<itunes:image href="https://his.fm/images/confirmed-cover.png" />');
    expect(xml).toContain('<itunes:email>confirmed-owner@example.test</itunes:email>');
    expect(xml).toContain('<itunes:author>Existing producer</itunes:author>');
    expect(xml).toContain('<itunes:name>Existing producer</itunes:name>');
    expect(xml).not.toContain('/brand/podcast.jpg');
  });

  it.each([
    ['/media/cover.jpg', 'https://f.no.mt/cover.jpg'],
    ['https://cdn.example.test/cover.jpg?x=1&v=2', 'https://cdn.example.test/cover.jpg?x=1&amp;v=2'],
    ['/brand/podcast.jpg', 'https://his.fm/brand/podcast.jpg'],
  ])('retains the configured channel artwork %s independently of item artwork', async (cover, url) => {
    site.podcastCoverUrl = cover;
    catalogue(episode({ seo: { ogImageUrl: 'https://cdn.example.test/custom-share.jpg' } }));
    const xml = await buildRssFeed(db, origin, mediaBase, media().bucket);
    expect(xml).toContain(`<itunes:image href="${url}" />`);
    expect(xml).toContain(`<itunes:image href="${origin}${await artUrl()}" />`);
    expect(xml).not.toContain('custom-share.jpg');
  });

  it('uses encoded stable episode IDs for each item artwork, not slugs or source covers', async () => {
    const id = 'episode /节目?&"#';
    catalogue(
      episode({ id, slug: 'first-slug' }),
      episode({ id: 'second-id', slug: 'other-slug' }),
      episode({ id: 'no-audio', audioUrl: null }),
    );
    const xml = await buildRssFeed(db, origin, mediaBase, media().bucket);
    const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map((match) => match[0]);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain(`<itunes:image href="${origin}${await artUrl(id)}" />`);
    expect(items[1]).toContain(`<itunes:image href="${origin}${await artUrl('second-id')}" />`);
    expect(xml).not.toContain('/episodes/no-audio/art.jpg');
    expect(xml).not.toContain('/images/episode-01.webp');
  });

  it('emits atom:author with the configured homepage and omits it when empty', async () => {
    site.podcastAuthor = '李征';
    site.podcastAuthorUrl = 'https://lizheng.dev';
    const withUrl = await buildRssFeed(db, origin, mediaBase, media().bucket);
    expect(withUrl).toContain(
      '<atom:author><atom:name>李征</atom:name><atom:uri>https://lizheng.dev</atom:uri></atom:author>',
    );
    site.podcastAuthorUrl = '';
    const withoutUrl = await buildRssFeed(db, origin, mediaBase, media().bucket);
    expect(withoutUrl).not.toContain('<atom:author');
    expect(withoutUrl).not.toContain('<atom:uri');
  });

  it.each([
    ['/media/audio.mp3', mediaBase, 'audio.mp3', `${mediaBase}/audio.mp3`],
    [
      `${mediaBase}/audio.mp3?download=1&v=2`,
      mediaBase,
      'audio.mp3',
      `${mediaBase}/audio.mp3?download=1&amp;v=2`,
    ],
    [`${origin}/media/audio.mp3`, mediaBase, 'audio.mp3', `${mediaBase}/audio.mp3`],
    [
      'https://cdn.example.test/podcast/audio.mp3',
      'https://cdn.example.test/podcast/',
      'audio.mp3',
      'https://cdn.example.test/podcast/audio.mp3',
    ],
    ['/media/audio.mp3', '/media', 'audio.mp3', `${origin}/media/audio.mp3`],
    [
      '/media///external.test/audio.mp3',
      mediaBase,
      '//external.test/audio.mp3',
      `${mediaBase}///external.test/audio.mp3`,
    ],
    [`${mediaBase}/audio%20one.mp3`, mediaBase, 'audio one.mp3', `${mediaBase}/audio%20one.mp3`],
  ])('resolves trusted media %s through R2', async (audioUrl, base, key, url) => {
    catalogue(episode({ audioUrl }));
    const { bucket, head } = media();
    const xml = await buildRssFeed(db, origin, base, bucket);
    expect(head).toHaveBeenCalledExactlyOnceWith(key);
    expect(xml).toContain(`<enclosure url="${url}" length="12345" type="audio/mpeg" />`);
  });

  it.each([
    null,
    '',
    '/images/not-audio.png',
    'https://external.example.test/audio.mp3',
    'https://f.no.mt.evil.test/audio.mp3',
    'https://f.no.mt@evil.test/audio.mp3',
    'https://user:password@f.no.mt/audio.mp3',
    'http://f.no.mt/audio.mp3',
    'https://[invalid/audio.mp3',
    '//f.no.mt/audio.mp3',
    '/media/audio.mp3#fragment',
    '/media/%ZZ.mp3',
    '/media/../outside.mp3',
    'javascript:alert(1)',
  ])('omits unresolvable or untrusted audio %s without R2 lookup', async (audioUrl) => {
    catalogue(episode({ audioUrl }));
    const { bucket, head } = media();
    const xml = await buildRssFeed(db, origin, mediaBase, bucket);
    expect(xml).not.toContain('<item>');
    expect(head).not.toHaveBeenCalled();
  });

  it('does not accept a CDN prefix outside its configured path', async () => {
    catalogue(episode({ audioUrl: 'https://cdn.example.test/podcasts-other/audio.mp3' }));
    const { bucket, head } = media();
    expect(await buildRssFeed(db, origin, 'https://cdn.example.test/podcasts', bucket)).not.toContain(
      '<item>',
    );
    expect(head).not.toHaveBeenCalled();
  });

  it('never invents an enclosure length when the bucket or object is unavailable', async () => {
    expect(await buildRssFeed(db, origin, mediaBase)).not.toContain('<item>');
    const { bucket, head } = media();
    head.mockResolvedValue(null);
    expect(await buildRssFeed(db, origin, mediaBase, bucket)).not.toContain('<item>');
    head.mockRejectedValue(new Error('R2 unavailable'));
    await expect(buildRssFeed(db, origin, mediaBase, bucket)).rejects.toThrow('R2 unavailable');
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid R2 byte length %s',
    async (size) => {
      const xml = await buildRssFeed(db, origin, mediaBase, media(size).bucket);
      expect(xml).not.toContain('<item>');
      expect(xml).not.toContain('length="0"');
    },
  );

  it.each(['image/png', 'text/html', 'application/octet-stream', 'video/mp4'])(
    'rejects known non-audio MIME %s even on an mp3 URL',
    async (contentType) => {
      expect(await buildRssFeed(db, origin, mediaBase, media(10, contentType).bucket)).not.toContain(
        '<item>',
      );
    },
  );

  it.each([
    ['/media/audio.mp3', 'Audio/MPEG; charset=binary', 'audio/mpeg'],
    ['/media/audio.mp3?download=1', '', 'audio/mpeg'],
  ])('uses valid audio type for %s (%s)', async (audioUrl, contentType, expected) => {
    catalogue(episode({ audioUrl }));
    const xml = await buildRssFeed(db, origin, mediaBase, media(10, contentType).bucket);
    expect(xml).toContain(`type="${expected}"`);
  });

  it.each(['audio/wav', 'audio/x-wav', ''])('omits WAV from directory RSS (%s)', async (contentType) => {
    catalogue(episode({ audioUrl: '/media/audio.wav' }));
    expect(await buildRssFeed(db, origin, mediaBase, media(10, contentType).bucket)).not.toContain('<item>');
  });

  it('does not infer WAV for unknown file types or missing MIME metadata', async () => {
    catalogue(episode({ audioUrl: '/media/cover.png' }));
    expect(await buildRssFeed(db, origin, mediaBase, media(10, '').bucket)).not.toContain('<item>');
  });

  it.each([
    [542.68, 543],
    [986.59, 987],
    [2259.39, 2259],
    [416.51, 417],
    [1.5, 2],
  ])(
    'rounds stored fractional duration %s to %s seconds without inferring from bytes',
    async (durationSeconds, expected) => {
      catalogue(episode({ durationSeconds }));
      const xml = await buildRssFeed(db, origin, mediaBase, media(987654).bucket);
      expect(xml).toContain(`<itunes:duration>${expected}</itunes:duration>`);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'omits invalid or unknown duration %s rather than fabricating it',
    async (durationSeconds) => {
      catalogue(episode({ durationSeconds }));
      const xml = await buildRssFeed(db, origin, mediaBase, media().bucket);
      expect(xml).toContain('<item>');
      expect(xml).not.toContain('<itunes:duration>');
    },
  );

  it.each([{ publishedAt: null }, { publishedAt: 'not-a-date' }, { title: ' ' }])(
    'omits malformed episode metadata %j',
    async (patch) => {
      catalogue(episode(patch));
      const { bucket, head } = media();
      expect(await buildRssFeed(db, origin, mediaBase, bucket)).not.toContain('<item>');
      expect(head).not.toHaveBeenCalled();
    },
  );

  it('keeps descriptions and mentions as escaped HTML without CDATA breakouts', async () => {
    catalogue(
      episode({
        title: 'Title <&> "quoted"',
        summary: 'Summary ]]><injected /> & text',
        mentions: [
          {
            name: 'Name ]]><injected />',
            description: 'Description <&>',
            url: 'https://example.test/?q=]]>&b=2',
          },
        ],
      }),
    );
    const xml = await buildRssFeed(db, origin, mediaBase, media().bucket);
    expect(xml).not.toContain('<![CDATA[');
    expect(xml).not.toContain(']]>');
    expect(xml).not.toContain('<injected');
    expect(xml).toContain('<title>Title &lt;&amp;&gt; &quot;quoted&quot;</title>');
    expect(xml).toContain('Summary ]]&amp;gt;&amp;lt;injected /&amp;gt; &amp;amp; text');
    expect(xml).toContain('&lt;section&gt;&lt;h2&gt;本期提到&lt;/h2&gt;');
    expect(xml).toContain('Name ]]&amp;gt;&amp;lt;injected /&amp;gt;');
    expect(xml).toContain('q=]]&amp;gt;&amp;amp;b=2');
  });

  it('keeps Chinese category identity outside the iTunes taxonomy and applies the same item filtering', async () => {
    catalogue(episode(), episode({ id: 'no-audio', slug: 'no-audio', audioUrl: null }));
    const xml = await buildCategoryRssFeed(
      db,
      origin,
      mediaBase,
      'manager-notes',
      '管理手记',
      media().bucket,
    );
    expect(xml).toContain('<title>管理手记 · his.fm</title>');
    expect(xml).toContain('<description>管理手记 栏目节目更新</description>');
    expect(xml).toContain('href="https://his.fm/feeds/manager-notes.xml"');
    expect(xml).toContain('<itunes:category text="Technology" />');
    expect(xml).not.toContain('text="管理手记"');
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(xml).toContain('<itunes:duration>123</itunes:duration>');
    expect(xml).toContain('<itunes:image href="https://his.fm/brand/podcast.jpg" />');
    expect(xml).toContain(`<itunes:image href="${origin}${await artUrl()}" />`);
    expect(xml).not.toContain('/episodes/no-audio/art.jpg');
    expect(listPublishedEpisodesInCategory).toHaveBeenCalledWith(db, 'manager-notes');
  });

  it('shares in-flight R2 lookups for the same trusted key', async () => {
    catalogue(
      episode(),
      episode({ id: 'episode-2', slug: 'episode-two', audioUrl: `${mediaBase}/audio.mp3` }),
    );
    const { bucket, head } = media();
    await buildRssFeed(db, origin, mediaBase, bucket);
    expect(head).toHaveBeenCalledExactlyOnceWith('audio.mp3');
    expect(listEpisodes).toHaveBeenCalledWith(db, true, undefined, origin);
  });
});
