import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://track-collect.nocoo.cloud/**', (route) => route.abort());
});

test('public SSR pages, navigation, search and health endpoints work against the built bundle', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const live = await request.get('/api/live');
  expect(live.status()).toBe(200);
  expect(await live.json()).toMatchObject({ status: 'ok', service: 'his.fm' });

  for (const [path, contentType] of [
    ['/robots.txt', 'text/plain'],
    ['/sitemap.xml', 'application/xml'],
    ['/site.webmanifest', 'application/manifest+json'],
    ['/apple-touch-icon.png', 'image/png'],
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain(contentType);
  }
  expect((await request.get('/episodes/missing-episode')).status()).toBe(404);

  const homeResponse = await page.goto('/');
  expect(homeResponse?.status()).toBe(200);
  expect(homeResponse?.headers()['content-security-policy']).toContain('script-src');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('今天就');
  await expect(page.locator('.episode-card').first()).toBeVisible();
  await expect(page.locator('footer a[href="/login"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('.episode-card img')
        .first()
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);

  await page.getByRole('link', { name: '找一期，歇一会儿' }).click();
  await expect(page).toHaveURL(/\/episodes$/);
  await expect(page.locator('.episode-card')).toHaveCount(2);

  await page
    .getByRole('navigation', { name: '播客栏目' })
    .getByRole('link', { name: '生活留白', exact: true })
    .click();
  await expect(page).toHaveURL(/\/episodes\?category=life$/);
  await expect(page.locator('.episode-card')).toHaveCount(1);

  await page.getByRole('navigation', { name: '播客栏目' }).getByRole('link', { name: /^全部/ }).click();
  await expect(page).toHaveURL(/\/episodes$/);
  await expect(page.locator('.episode-card')).toHaveCount(2);
  await page.getByRole('searchbox', { name: '搜索播客' }).fill('AI 学习');
  await expect(page.locator('.episode-card')).toHaveCount(1);

  await page.getByRole('link', { name: '下班后，还要追多少个 AI？', exact: true }).click();
  await expect(page).toHaveURL(/\/episodes\/manager-notes\/how-many-ai-tools-after-work$/);
  await expect(page.locator('.detail-intro').getByRole('heading', { level: 1 })).toHaveText(
    '下班后，还要追多少个 AI？',
  );
  await expect(page.locator('#reading-panel .episode-topics > li')).toHaveCount(2);

  const apiEpisode = await request.get('/api/episodes/how-many-ai-tools-after-work');
  expect(apiEpisode.ok()).toBe(true);
  const episodeBody = (await apiEpisode.json()) as { episode: Record<string, unknown> };
  expect(episodeBody.episode).not.toHaveProperty('transcript');
  expect(JSON.stringify(episodeBody.episode)).not.toMatch(/逐字稿|transcript/i);

  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('his.fm');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('login shell renders and preserves theme preference without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(() => localStorage.setItem('hisfm-theme', 'dark'));
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.getByRole('heading', { name: '欢迎回到工作室' })).toBeVisible();
  expect(errors).toEqual([]);
});
