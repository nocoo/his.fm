import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCategory } from '../../worker/categories';
import { buildCategoryRssFeed, buildRssFeed } from '../../worker/feed';
import { conditionalFeedResponse, feedResponse, feedRoute } from '../../worker/feed-response';

vi.mock('../../worker/categories', () => ({ getCategory: vi.fn() }));
vi.mock('../../worker/feed', () => ({ buildCategoryRssFeed: vi.fn(), buildRssFeed: vi.fn() }));

const env = { DB: {}, MEDIA: {}, MEDIA_BASE_URL: 'https://f.no.mt' } as Env;
const request = (path = '/feed.xml', init?: RequestInit) => new Request(`https://his.fm${path}`, init);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(buildRssFeed).mockResolvedValue('<rss>channel</rss>');
  vi.mocked(buildCategoryRssFeed).mockResolvedValue('<rss>category</rss>');
  vi.mocked(getCategory).mockResolvedValue({ id: 'learning', name: '每日手冲' } as Awaited<
    ReturnType<typeof getCategory>
  >);
});

describe('feed HTTP responses', () => {
  it('recognizes only exact feed routes', () => {
    for (const path of ['/feed.xml', '/feeds/learning.xml']) expect(feedRoute.test(path)).toBe(true);
    for (const path of ['/feed.xml/other', '/feeds/.xml', '/feeds/UPPER.xml', '/feeds/a/b.xml'])
      expect(feedRoute.test(path)).toBe(false);
  });

  it('sets an XML type, short TTL and content-derived ETag', async () => {
    const response = await feedResponse(request(), env);
    expect(await response.text()).toBe('<rss>channel</rss>');
    expect(response.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(response.headers.get('ETag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(buildRssFeed).toHaveBeenCalledWith(env.DB, 'https://his.fm', 'https://f.no.mt', env.MEDIA);
    const previous = response.headers.get('ETag');
    vi.mocked(buildRssFeed).mockResolvedValue('<rss>changed</rss>');
    expect((await feedResponse(request(), env)).headers.get('ETag')).not.toBe(previous);
  });

  it('uses the production media base when the binding is absent', async () => {
    await feedResponse(request(), { ...env, MEDIA_BASE_URL: undefined } as unknown as Env);
    expect(buildRssFeed).toHaveBeenCalledWith(env.DB, 'https://his.fm', 'https://f.no.mt', env.MEDIA);
  });

  it('resolves category names and preserves unknown-category failures', async () => {
    expect(await (await feedResponse(request('/feeds/learning.xml'), env)).text()).toBe(
      '<rss>category</rss>',
    );
    expect(buildCategoryRssFeed).toHaveBeenCalledWith(
      env.DB,
      'https://his.fm',
      'https://f.no.mt',
      'learning',
      '每日手冲',
      env.MEDIA,
    );
    vi.mocked(getCategory).mockRejectedValue(new Error('missing'));
    await expect(feedResponse(request('/feeds/missing.xml'), env)).rejects.toThrow('missing');
  });

  it('rejects writes before querying data', async () => {
    await expect(feedResponse(request('/feed.xml', { method: 'POST' }), env)).rejects.toMatchObject({
      status: 405,
    });
    expect(buildRssFeed).not.toHaveBeenCalled();
  });

  it('returns bodyless HEAD with the same ETag', async () => {
    const get = await feedResponse(request(), env);
    const head = await feedResponse(request('/feed.xml', { method: 'HEAD' }), env);
    expect(await head.text()).toBe('');
    expect(head.headers.get('ETag')).toBe(get.headers.get('ETag'));
  });

  it.each(['"same"', 'W/"same"', '"other", W/"same"', '*'])(
    'honors If-None-Match %s on cached or fresh output',
    async (etag) => {
      const response = conditionalFeedResponse(
        request('/feed.xml', { headers: { 'If-None-Match': etag } }),
        new Response('body', { headers: { ETag: '"same"', 'Content-Length': '4' } }),
      );
      expect(response.status).toBe(304);
      expect(await response.text()).toBe('');
      expect(response.headers.has('Content-Length')).toBe(false);
    },
  );

  it('does not turn missing validators or failed responses into 304', async () => {
    for (const response of [
      new Response('body'),
      new Response('body', { status: 503, headers: { ETag: '"same"' } }),
      new Response('body', { headers: { ETag: '"different"' } }),
    ]) {
      const result = conditionalFeedResponse(
        request('/feed.xml', { headers: { 'If-None-Match': '"same"' } }),
        response,
      );
      expect(result.status).not.toBe(304);
      expect(await result.text()).toBe('body');
    }
    expect(conditionalFeedResponse(request('/feed.xml', { method: 'HEAD' }), new Response(null)).status).toBe(
      200,
    );
    expect(
      conditionalFeedResponse(
        request('/feed.xml', { headers: { 'If-None-Match': '*' } }),
        new Response(null, { headers: { ETag: '"same"' } }),
      ).status,
    ).toBe(304);
  });
});
