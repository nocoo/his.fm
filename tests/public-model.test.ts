import { afterEach, describe, expect, it, vi } from 'vitest';
import { categoryLabel, dateLabel, durationLabel, filterEpisodes, getEpisodes } from '../src/public/model';
import type { Episode } from '../src/shared/episode';

const episodes: Episode[] = [
  {
    id: '1',
    slug: 'after-work',
    episodeNumber: 1,
    title: '下班后的 AI',
    summary: '从工作回到生活',
    transcript: '',
    showNotes: '',
    coverUrl: '/images/episode-01.webp',
    category: 'work',
    tags: ['开发者'],
    durationSeconds: 600,
    audioUrl: null,
    status: 'published',
    featured: true,
    publishedAt: '2026-09-25T08:00:00Z',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: '2',
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
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listening room', () => {
  it('combines category and case-insensitive title, summary and tag search', () => {
    expect(filterEpisodes(episodes, 'all', '')).toHaveLength(2);
    expect(filterEpisodes(episodes, 'work', '  ai ')).toEqual([episodes[0]]);
    expect(filterEpisodes(episodes, 'all', '路边')).toEqual([episodes[1]]);
    expect(filterEpisodes(episodes, 'all', '开发者')).toEqual([episodes[0]]);
    expect(filterEpisodes(episodes, 'life', 'AI')).toEqual([]);
  });
  it('formats dates consistently in Shanghai and represents unfinished media honestly', () => {
    expect(dateLabel('2026-09-24T22:00:00Z')).toBe('2026.09.25');
    expect(dateLabel(null)).toBe('即将发布');
    expect(durationLabel(601)).toBe('11 分钟');
    expect(durationLabel(0)).toBe('时长待定');
    expect(categoryLabel('work')).toBe('工作之间');
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
