import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { PublicData } from '../../src/public/PublicData';
import type { Category } from '../../src/shared/category';
import { type Episode, projectPublicEpisode } from '../../src/shared/episode';
import { e2eOrigin } from './origin';

const episode: Episode = {
  id: 'catalogue-test',
  version: 1,
  slug: 'catalogue-test',
  episodeNumber: 1,
  title: '本期的具体话题',
  summary: '浏览和收听这期已经发布的节目。',
  transcript: '',
  lead: '',
  researchNote: '',
  credits: '',
  body: '',
  topics: [],
  coverUrl: '/images/episode-01.webp',
  category: 'learning',
  tags: [],
  mentions: [],
  seo: {},
  durationSeconds: 60,
  audioUrl: null,
  status: 'published',
  featured: false,
  publishedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '',
  updatedAt: '',
};

test('SSR catalogue data continues to resolve route metadata after revalidation fails', async ({ page }) => {
  const headers = { Origin: e2eOrigin() };
  expect((await page.request.post('/admin/api/dev-login', { headers })).ok()).toBe(true);
  const created = await page.request.post('/admin/api/categories', {
    headers,
    data: { name: `索引验收-${randomUUID().slice(0, 8)}`, icon: 'coffee', color: 'blue' },
  });
  expect(created.status()).toBe(201);
  const { category: empty } = (await created.json()) as { category: Category };
  try {
    for (const path of ['episodes', 'categories'])
      await page.route(`**/api/${path}`, (route) =>
        route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
      );
    await page.goto('/episodes?theme=stillwood');
    const snapshot = (await page.evaluate(() =>
      JSON.parse(document.getElementById('public-data')?.textContent ?? '{}'),
    )) as PublicData;
    const populated = snapshot.categories.find((category) =>
      snapshot.episodes.some((entry) => entry.category === category.id),
    );
    if (!populated) throw new Error('Local catalogue fixture needs a published episode');
    await expect(page.locator('.library-message[role="alert"]')).toBeVisible();
    const nav = page.getByRole('navigation', { name: '播客栏目' });
    for (const [category, robots] of [
      [populated, 'index, follow'],
      [empty, 'noindex, follow'],
      [populated, 'index, follow'],
    ] as const) {
      await nav.getByRole('link', { name: category.name, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(category.name);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', robots);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new URL(`/episodes?category=${category.id}`, page.url()).href,
      );
      await expect.poll(() => page.title()).toContain(category.name);
    }
  } finally {
    expect(
      (
        await page.request.delete(`/admin/api/categories/${empty.id}?version=${empty.version}`, { headers })
      ).status(),
    ).toBe(204);
  }
});

for (const width of [390, 1440]) {
  test(`programme links, introduction and indexability survive navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/episodes', (route) =>
      route.fulfill({
        json: { episodes: [projectPublicEpisode(episode, new URL(route.request().url()).origin)] },
      }),
    );
    await page.route('**/api/categories', (route) =>
      route.fulfill({
        json: {
          categories: [
            {
              id: 'learning',
              name: '每日手冲',
              icon: 'coffee',
              color: 'blue',
              seo: { description: '听 AI 与科技动态，也聊技术怎样进入工作。' },
            },
            { id: 'empty', name: '尚未开播的栏目', icon: 'leaf', color: 'teal', seo: {} },
          ],
        },
      }),
    );
    await page.goto('/episodes?category=learning&theme=stillwood');
    const nav = page.getByRole('navigation', { name: '播客栏目' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('每日手冲');
    await expect(page.locator('.page-heading')).toContainText('听 AI 与科技动态，也聊技术怎样进入工作。');
    await expect(page.locator('.episode-card')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: '每日手冲', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: '尚未开播的栏目' })).toHaveAttribute(
      'href',
      '/episodes?category=empty&theme=stillwood',
    );
    await expect(page.getByRole('link', { name: '订阅栏目 RSS' })).toHaveAttribute(
      'href',
      '/feeds/learning.xml',
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await page.getByRole('searchbox', { name: '搜索播客' }).fill('没有匹配结果');
    await expect(page.locator('.episode-card')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await page.getByRole('searchbox', { name: '搜索播客' }).clear();
    await nav.getByRole('link', { name: '尚未开播的栏目' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('尚未开播的栏目');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new URL('/episodes?category=empty', page.url()).href,
    );
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('每日手冲');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('每日手冲');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
