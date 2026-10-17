import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appearanceHref,
  catalogueCategoryFromSearch,
  catalogueSearchParamsForCategory,
  categoryLabel,
  dateLabel,
  durationLabel,
  episodeDisplayLabel,
  filterEpisodes,
  getAppearance,
  getCategories,
  getEpisodes,
} from '../src/public/model';
import { type Episode, projectPublicEpisode } from '../src/shared/episode';

const rawEpisodes: Episode[] = [
  {
    id: '1',
    version: 1,
    slug: 'after-work',
    episodeNumber: 1,
    title: '下班后的 AI',
    summary: '从工作回到生活',
    transcript: '',
    showNotes: '',
    coverUrl: '/images/episode-01.webp',
    category: 'manager-notes',
    tags: ['开发者'],
    durationSeconds: 600,
    audioUrl: null,
    status: 'published',
    featured: true,
    publishedAt: '2026-09-25T08:00:00Z',
    createdAt: '',
    updatedAt: '',
    mentions: [],
    seo: {},
  },
  {
    id: '2',
    version: 1,
    slug: 'walking',
    episodeNumber: 2,
    title: '去散步',
    summary: '看看路边的树',
    transcript: '',
    showNotes: '',
    coverUrl: '/images/episode-02.webp',
    category: 'life',
    tags: ['不带手机'],
    durationSeconds: 0,
    audioUrl: null,
    status: 'published',
    featured: false,
    publishedAt: null,
    createdAt: '',
    updatedAt: '',
    mentions: [],
    seo: {},
  },
];
const episodes = rawEpisodes.map((episode) => projectPublicEpisode(episode, 'https://his.fm.test'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('website appearance', () => {
  it('loads public category metadata without private prompt fields', async () => {
    const categories = [{ id: 'new-category', name: '新栏目', icon: 'mic', color: 'blue', seo: {} }];
    const request = vi.fn().mockResolvedValue(Response.json({ categories }));
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    expect(await getCategories(signal)).toEqual(categories);
    expect(request).toHaveBeenCalledWith('/api/categories', { signal });
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(getCategories()).rejects.toThrow('栏目');
  });
  it('loads the current theme without a browser cache and forwards cancellation', async () => {
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValue(Response.json({ appearance: { theme: 'stillwood' } }));
    vi.stubGlobal('fetch', request);
    await expect(getAppearance(controller.signal)).resolves.toEqual({ theme: 'stillwood' });
    expect(request).toHaveBeenCalledWith('/api/appearance', { signal: controller.signal, cache: 'no-store' });
  });
  it('rejects unavailable or unrecognized settings instead of silently choosing another theme', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', request);
    await expect(getAppearance()).rejects.toThrow('网站外观暂时没有加载出来');
    for (const body of [
      {},
      { appearance: { theme: 'missing' } },
      { appearance: { theme: 'grove', email: 'private' } },
    ]) {
      request.mockResolvedValue(Response.json(body));
      await expect(getAppearance()).rejects.toThrow('网站外观设置无法识别');
    }
    request.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    await expect(getAppearance(AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('preserves public preview across navigation, existing queries and fragments', () => {
    expect(appearanceHref('/episodes', 'interval')).toBe('/episodes?theme=interval');
    expect(appearanceHref('/about?from=home#story', 'tidal-hours')).toBe(
      '/about?from=home&theme=tidal-hours#story',
    );
    expect(appearanceHref('/?theme=grove', 'alpine-bloom')).toBe('/?theme=alpine-bloom');
    expect(appearanceHref('/episodes?from=home', null)).toBe('/episodes?from=home');
    expect(appearanceHref('/login', 'interval')).toBe('/login');
    expect(appearanceHref('/admin/appearance', 'interval')).toBe('/admin/appearance');
  });
});

describe('listening room', () => {
  it('combines category and case-insensitive title, summary and tag search', () => {
    expect(filterEpisodes(episodes, 'all', '')).toHaveLength(2);
    expect(filterEpisodes(episodes, 'manager-notes', '  ai ')).toEqual([episodes[0]]);
    expect(filterEpisodes(episodes, 'all', '路边')).toEqual([episodes[1]]);
    expect(filterEpisodes(episodes, 'all', '开发者')).toEqual([episodes[0]]);
    expect(filterEpisodes(episodes, 'life', 'AI')).toEqual([]);
    expect(catalogueCategoryFromSearch(null)).toBe('all');
    expect(catalogueCategoryFromSearch('manager-notes')).toBe('manager-notes');
    const params = new URLSearchParams('category=life&q=1');
    expect(catalogueSearchParamsForCategory(params, 'manager-notes').toString()).toBe(
      'category=manager-notes&q=1',
    );
    expect(catalogueSearchParamsForCategory(params, 'all').toString()).toBe('q=1');
  });
  it('formats dates consistently in Shanghai and represents unfinished media honestly', () => {
    expect(dateLabel('2026-09-24T22:00:00Z')).toBe('2026.09.25');
    expect(dateLabel(null)).toBe('即将发布');
    expect(durationLabel(601)).toBe('11 分钟');
    expect(durationLabel(0)).toBe('时长待定');
    expect(
      categoryLabel('manager-notes', [
        { id: 'manager-notes', name: '主理人手札', icon: 'briefcase-business', color: 'blue', seo: {} },
      ]),
    ).toBe('主理人手札');
    expect(episodeDisplayLabel(episodes[0], [])).toContain('栏目 EP.');
    expect(episodeDisplayLabel({ category: 'missing', episodeNumber: 3 }, [])).toBe('栏目 EP.03');
  });
  it('loads published episodes and forwards cancellation', async () => {
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValue(Response.json({ episodes }));
    vi.stubGlobal('fetch', request);
    await expect(getEpisodes(controller.signal)).resolves.toEqual(episodes);
    expect(request).toHaveBeenCalledWith('/api/episodes', { signal: controller.signal });
  });
  it('reports HTTP and transport errors instead of inventing an empty catalogue', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', request);
    await expect(getEpisodes()).rejects.toThrow('节目暂时没有加载出来');
    request.mockRejectedValue(new Error('offline'));
    await expect(getEpisodes()).rejects.toThrow('offline');
  });
});
