import { beforeEach, describe, expect, it, vi } from 'vitest';
import { themes } from '../../src/brand/themes';
import { type Episode, projectPublicEpisode } from '../../src/shared/episode';
import { getAppearance } from '../../worker/appearance';
import { buildEpisodeCard, parseEpisodePageUrl, routeEpisodeCard } from '../../worker/card';
import { getCategory } from '../../worker/categories';
import { findPublishedEpisodeByCategorySlug, resolveCategoryAlias } from '../../worker/episode-public';
import { getEpisode } from '../../worker/episodes';
import { enclosureForEpisode } from '../../worker/feed';
import { HttpError } from '../../worker/http';

vi.mock('../../worker/episodes', () => ({ getEpisode: vi.fn() }));
vi.mock('../../worker/appearance', () => ({ getAppearance: vi.fn() }));
vi.mock('../../worker/categories', () => ({ getCategory: vi.fn() }));
vi.mock('../../worker/episode-public', () => ({
  findPublishedEpisodeByCategorySlug: vi.fn(),
  resolveCategoryAlias: vi.fn(),
}));
vi.mock('../../worker/feed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../worker/feed')>();
  return { ...actual, enclosureForEpisode: vi.fn() };
});

const origin = 'https://his.fm';
const mediaBase = 'https://f.no.mt';

function episode(patch: Partial<Episode> = {}): Episode {
  return {
    id: 'episode-1',
    version: 3,
    slug: 'leave-a-note',
    episodeNumber: 3,
    title: '给明天留一张纸条',
    summary: '记录今天停下来的位置。',
    transcript: 'hidden',
    lead: '',
    researchNote: '',
    credits: '',
    body: '',
    topics: [],
    coverUrl: '/media/covers/note.webp',
    category: 'manager-notes',
    tags: [],
    mentions: [],
    seo: {},
    durationSeconds: 321,
    audioUrl: '/media/audio.mp3',
    status: 'published',
    featured: false,
    publishedAt: '2026-01-15T08:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...patch,
  };
}

function env(bucket?: R2Bucket) {
  return { DB: {} as D1Database, MEDIA: bucket, MEDIA_BASE_URL: mediaBase } as Env;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveCategoryAlias).mockImplementation(async (_db, id) => id);
  vi.mocked(findPublishedEpisodeByCategorySlug).mockResolvedValue(true);
  vi.mocked(getAppearance).mockResolvedValue({
    theme: 'interval',
    version: 1,
    updatedAt: '',
    updatedBy: '',
  });
  vi.mocked(getCategory).mockResolvedValue({
    id: 'manager-notes',
    name: '主理人手札',
    icon: 'book-open',
    color: 'slate',
    seo: {},
    version: 1,
    updatedAt: '',
    updatedBy: '',
  });
  vi.mocked(getEpisode).mockImplementation(async () => projectPublicEpisode(episode(), origin));
  vi.mocked(enclosureForEpisode).mockResolvedValue({
    url: `${mediaBase}/audio.mp3`,
    length: 2048,
    type: 'audio/mpeg',
  });
});

describe('parseEpisodePageUrl', () => {
  it('accepts canonical episode page URLs on the request origin', () => {
    expect(parseEpisodePageUrl('https://his.fm/episodes/manager-notes/leave-a-note/', origin)).toEqual({
      category: 'manager-notes',
      slug: 'leave-a-note',
    });
    expect(
      parseEpisodePageUrl('https://his.fm/episodes/manager-notes/leave-a-note?ref=blog#play', origin),
    ).toEqual({
      category: 'manager-notes',
      slug: 'leave-a-note',
    });
    expect(
      parseEpisodePageUrl(
        'https://hisfm.dev.hexly.ai/episodes/learning/daily-brew',
        'https://hisfm.dev.hexly.ai',
      ),
    ).toEqual({ category: 'learning', slug: 'daily-brew' });
  });

  it('rejects missing, foreign or non-episode URLs', () => {
    expect(parseEpisodePageUrl(null, origin)).toBeNull();
    expect(parseEpisodePageUrl('', origin)).toBeNull();
    expect(parseEpisodePageUrl('not-a-url', origin)).toBeNull();
    expect(parseEpisodePageUrl('https://evil.test/episodes/a/b', origin)).toBeNull();
    expect(parseEpisodePageUrl('https://his.fm/about', origin)).toBeNull();
    expect(parseEpisodePageUrl('https://his.fm/episodes/only-one-segment', origin)).toBeNull();
    expect(parseEpisodePageUrl('https://his.fm/episodes/BAD/slug', origin)).toBeNull();
  });
});

describe('buildEpisodeCard', () => {
  it('returns protocol v1 fields with enclosure, thumbnails and theme colors', async () => {
    const card = await buildEpisodeCard(env({} as R2Bucket), origin, 'manager-notes', 'leave-a-note');
    expect(card).toMatchObject({
      v: 1,
      status: 'published',
      page_url: 'https://his.fm/episodes/manager-notes/leave-a-note',
      title: '给明天留一张纸条',
      description: '记录今天停下来的位置。',
      show: 'his.fm',
      column: '主理人手札',
      episode_label: '主理人手札 EP.03',
      published_at: '2026-01-15T08:00:00.000Z',
      duration: 321,
      audio: { url: `${mediaBase}/audio.mp3`, mime: 'audio/mpeg', bytes: 2048 },
      cover: {
        url: `${mediaBase}/covers/note.webp`,
        width: 1400,
        height: 1400,
        frame_svg: 'https://his.fm/brand/frames/interval.svg',
        sizes: expect.arrayContaining([{ url: expect.stringContaining('/480.webp'), width: 480 }]),
      },
      theme: {
        name: themes.interval.name,
        accent: themes.interval.palette[2],
        ink: themes.interval.palette[1],
        paper: themes.interval.palette[0],
      },
    });
  });

  it('omits audio when the RSS enclosure resolver has no playable media', async () => {
    vi.mocked(enclosureForEpisode).mockResolvedValue(null);
    const card = await buildEpisodeCard(env({} as R2Bucket), origin, 'manager-notes', 'leave-a-note');
    expect(card).not.toHaveProperty('audio');
  });

  it('returns null for missing published episodes', async () => {
    vi.mocked(findPublishedEpisodeByCategorySlug).mockResolvedValue(false);
    expect(await buildEpisodeCard(env({} as R2Bucket), origin, 'manager-notes', 'missing')).toBeNull();
    vi.mocked(findPublishedEpisodeByCategorySlug).mockResolvedValue(true);
    vi.mocked(getEpisode).mockRejectedValue(new HttpError(404, '这期节目不存在'));
    expect(await buildEpisodeCard(env({} as R2Bucket), origin, 'manager-notes', 'missing')).toBeNull();
  });
});

describe('routeEpisodeCard', () => {
  it('sets CORS, cache and JSON headers for GET, HEAD and OPTIONS', async () => {
    const get = await routeEpisodeCard(
      new Request('https://his.fm/api/card?url=https://his.fm/episodes/manager-notes/leave-a-note'),
      env(),
    );
    expect(get.status).toBe(200);
    expect(get.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(get.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600');
    expect(get.headers.get('Content-Type')).toContain('application/json');
    const body = await get.json();
    expect(body).toMatchObject({ v: 1, status: 'published' });

    const head = await routeEpisodeCard(
      new Request('https://his.fm/api/card?url=https://his.fm/episodes/manager-notes/leave-a-note', {
        method: 'HEAD',
      }),
      env(),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600');

    const options = await routeEpisodeCard(
      new Request('https://his.fm/api/card', { method: 'OPTIONS' }),
      env(),
    );
    expect(options.status).toBe(204);
    expect(options.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, OPTIONS');
  });

  it('returns 400 for invalid URLs and 404 for unpublished episodes', async () => {
    const bad = await routeEpisodeCard(new Request('https://his.fm/api/card'), env());
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: '节目页面链接无效' });

    vi.mocked(findPublishedEpisodeByCategorySlug).mockResolvedValue(false);
    const missing = await routeEpisodeCard(
      new Request('https://his.fm/api/card?url=https://his.fm/episodes/manager-notes/missing'),
      env(),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ v: 1, status: 'not_found' });
    expect(missing.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
});
