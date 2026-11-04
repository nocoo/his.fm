import { describe, expect, it, vi } from 'vitest';
import { feedRoute } from '../../worker/feed-response';
import {
  maybeRedirectCatalogueCategoryRequest,
  maybeRedirectCategoryFeedRequest,
} from '../../worker/public-cache-redirects';

const resolveCategoryAlias = vi.fn(async (_db: D1Database, categoryId: string) => categoryId);

vi.mock('../../worker/episode-public', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../worker/episode-public')>()),
  resolveCategoryAlias: (...args: Parameters<typeof resolveCategoryAlias>) => resolveCategoryAlias(...args),
}));

describe('public cache redirects', () => {
  it('redirects aliased catalogue categories before cache lookup', async () => {
    resolveCategoryAlias.mockResolvedValueOnce('look-outside');
    const response = await maybeRedirectCatalogueCategoryRequest(
      new Request('https://his.fm/episodes?category=life&page=2'),
      {} as D1Database,
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get('Location')).toBe('/episodes?category=look-outside&page=2');
  });

  it('skips catalogue redirects for non-catalogue routes and non-GET methods', async () => {
    expect(
      await maybeRedirectCatalogueCategoryRequest(new Request('https://his.fm/about'), {} as D1Database),
    ).toBeNull();
    expect(
      await maybeRedirectCatalogueCategoryRequest(
        new Request('https://his.fm/episodes?category=life', { method: 'POST' }),
        {} as D1Database,
      ),
    ).toBeNull();
  });

  it('skips catalogue redirects when category is missing or all', async () => {
    expect(
      await maybeRedirectCatalogueCategoryRequest(new Request('https://his.fm/episodes'), {} as D1Database),
    ).toBeNull();
    expect(
      await maybeRedirectCatalogueCategoryRequest(
        new Request('https://his.fm/episodes?category=all'),
        {} as D1Database,
      ),
    ).toBeNull();
  });

  it('skips catalogue redirects when the alias resolves to the same id', async () => {
    resolveCategoryAlias.mockResolvedValueOnce('life');
    expect(
      await maybeRedirectCatalogueCategoryRequest(
        new Request('https://his.fm/episodes?category=life'),
        {} as D1Database,
      ),
    ).toBeNull();
  });

  it('redirects aliased category feeds', async () => {
    resolveCategoryAlias.mockResolvedValueOnce('look-outside');
    const response = await maybeRedirectCategoryFeedRequest(
      new Request('https://his.fm/feeds/life.xml'),
      {} as D1Database,
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get('Location')).toBe('/feeds/look-outside.xml');
    expect(feedRoute.test('/feeds/life.xml')).toBe(true);
  });

  it('skips feed redirects for non-feed routes and unchanged ids', async () => {
    expect(
      await maybeRedirectCategoryFeedRequest(new Request('https://his.fm/feed.xml'), {} as D1Database),
    ).toBeNull();
    resolveCategoryAlias.mockResolvedValueOnce('life');
    expect(
      await maybeRedirectCategoryFeedRequest(new Request('https://his.fm/feeds/life.xml'), {} as D1Database),
    ).toBeNull();
  });
});
