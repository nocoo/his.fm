import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteSeoService } from './service';

afterEach(() => vi.unstubAllGlobals());

describe('site seo service', () => {
  it('reads and saves through the admin API', async () => {
    const seo = {
      siteName: 'his.fm',
      titleSuffix: ' · his.fm',
      defaultTitle: 'his.fm',
      defaultDescription: 'desc',
      defaultOgImageUrl: '/images/episode-01.webp',
      podcastDescription: 'podcast',
      podcastAuthor: 'his.fm',
      language: 'zh-CN',
      itunesCategory: 'Technology',
      itunesExplicit: false,
      version: 2,
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'owner',
    };
    const request = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ seo })));
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    await expect(siteSeoService.read(signal)).resolves.toEqual({ seo });
    expect(request).toHaveBeenLastCalledWith(
      '/admin/api/seo',
      expect.objectContaining({ signal, credentials: 'same-origin' }),
    );
    await expect(siteSeoService.save({ siteName: 'his.fm', version: 2 })).resolves.toEqual({ seo });
    expect(request).toHaveBeenLastCalledWith(
      '/admin/api/seo',
      expect.objectContaining({ method: 'PUT', body: '{"siteName":"his.fm","version":2}' }),
    );
  });
});
