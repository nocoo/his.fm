import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/**
 * The dev server hydrates later than `load` because the React entry is imported dynamically,
 * so a click can land before React owns the DOM. Retry until the interaction takes effect.
 */
async function clickWhenHydrated(click: () => Promise<void>, settled: () => Promise<void>) {
  await expect(async () => {
    await click();
    await settled();
  }).toPass({ timeout: 20_000 });
}

for (const width of [375, 390, 430, 1440]) {
  test(`episode artwork starts at the top and fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/episodes/manager-notes/how-many-ai-tools-after-work?theme=interval');
    const artwork = page.locator('.detail-art');
    await expect(artwork.locator('.framed-cover')).toBeVisible();
    const art = await artwork.boundingBox();
    const intro = await page.locator('.detail-intro').boundingBox();
    const hero = await page.locator('.episode-detail-hero').boundingBox();
    if (!art || !intro || !hero) throw new Error('Missing episode layout');
    expect(Math.abs(art.y - hero.y)).toBeLessThan(1);
    expect(Math.abs(art.x - hero.x)).toBeLessThan(1);
    if (width < 760) {
      expect(Math.abs(art.width - hero.width)).toBeLessThan(1);
      expect(intro.y - (art.y + art.height)).toBeGreaterThanOrEqual(20);
      expect(intro.y - (art.y + art.height)).toBeLessThanOrEqual(32);
      expect(await artwork.evaluate((element) => getComputedStyle(element).position)).toBe('static');
    } else {
      expect(Math.abs(art.y - intro.y)).toBeLessThan(1);
      expect(await artwork.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: `.local/episode-layout-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}

test('listeners can browse, filter and read episode summaries without transcripts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?theme=interval');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('今天就');
  const homeGroups = page.locator('.programme-group');
  const homeCards = page.locator('.episode-card');
  expect(await homeGroups.count()).toBeGreaterThan(0);
  for (const group of await homeGroups.all()) {
    expect(await group.locator('.episode-card').count()).toBeLessThanOrEqual(3);
  }
  for (const card of await homeCards.all()) {
    await expect(card.locator('.framed-cover-overlay')).toHaveAttribute('src', '/brand/frames/interval.svg');
  }
  await page.getByRole('link', { name: '找一期，歇一会儿' }).click();
  await expect(page).toHaveURL(/\/episodes\?theme=interval$/);
  await expect(page.locator('.episode-card')).toHaveCount(6);
  await page
    .getByRole('navigation', { name: '播客栏目' })
    .getByRole('link', { name: '生活留白', exact: true })
    .click();
  await expect(page.locator('.episode-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('生活留白');
  await expect(page.getByRole('link', { name: '订阅栏目 RSS' })).toHaveAttribute('href', '/feeds/life.xml');
  await page.goBack();
  await expect(page.locator('.episode-card')).toHaveCount(6);
  await page.goForward();
  await expect(page.locator('.episode-card')).toHaveCount(2);
  await page.getByRole('searchbox', { name: '搜索播客' }).fill('不存在的关键词');
  await expect(page.getByRole('heading', { name: '还没聊到这个话题。' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索播客' }).fill('AI 学习');
  await expect(page.locator('.episode-card')).toHaveCount(1);
  await page.getByRole('link', { name: '下班后，还要追多少个 AI？', exact: true }).click();
  const pageTitle = page.locator('.detail-intro').getByRole('heading', { level: 1 });
  await expect(pageTitle).toHaveText('下班后，还要追多少个 AI？');
  const outline = page.locator('.episode-outline');
  await expect(outline.getByRole('heading', { name: '本期讲什么' })).toBeVisible();
  expect(await outline.locator('li').count()).toBeGreaterThanOrEqual(3);
  await expect(outline.locator('li').first()).toContainText('603 条建议');
  const reading = page.locator('#reading-panel');
  await expect(reading.locator('.episode-lead')).toContainText('下班又打开了新工具的教程');
  await expect(reading.locator('.episode-topics > li')).toHaveCount(6);
  await expect(reading.locator('#topic-2 h3')).toHaveText('连续两周限制睡眠');
  const source = reading.getByRole('link', { name: 'HowToLiveBetter：《高性价比人生指南》', exact: true });
  await expect(source).toHaveAttribute('href', 'https://github.com/eternity4719/HowToLiveBetter');
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByText('声音正在准备中')).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '逐字稿' })).toHaveCount(0);
  const apiEpisode = await page.request.get('/api/episodes/how-many-ai-tools-after-work');
  expect(apiEpisode.ok()).toBe(true);
  const body = (await apiEpisode.json()) as { episode: Record<string, unknown> };
  expect(body.episode).not.toHaveProperty('transcript');
  expect(JSON.stringify(body.episode)).not.toMatch(/逐字稿|transcript/i);
  await page.reload();
  await expect(pageTitle).toHaveText('下班后，还要追多少个 AI？');
  await page.goto('/episodes/missing-episode');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('别的频道');
  expect(errors).toEqual([]);
});

test('theme preview swaps the cover frame overlay on episode art', async ({ page }) => {
  await page.goto('/?theme=stillwood');
  await expect(page.locator('.episode-card .framed-cover-overlay').first()).toHaveAttribute(
    'src',
    '/brand/frames/stillwood.svg',
  );
  await page.goto('/?theme=human-sample');
  await expect(page.locator('.episode-card .framed-cover-overlay').first()).toHaveAttribute(
    'src',
    '/brand/frames/human-sample.svg',
  );
});

test('public pages fit a phone and respect reduced motion', async ({ page }) => {
  await mkdir('.local', { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.programme-group').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden();
  const nav = page.getByRole('navigation', { name: '主导航' });
  await clickWhenHydrated(
    () => page.getByRole('button', { name: '打开导航' }).click(),
    () => expect(nav).toBeVisible(),
  );
  await nav.getByRole('link', { name: '关于 his.fm' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('his.fm');
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden();
  for (const path of ['/', '/episodes', '/episodes/how-many-ai-tools-after-work', '/about']) {
    await page.goto(path);
    await expect(page.locator('main h1:not(article h1)')).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, `${path} fits the viewport`).toBe(true);
  }
  await page.goto('/');
  await expect(page.locator('.programme-group').first()).toBeVisible();
  expect(
    await page.locator('.pace-line').evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.screenshot({ path: '.local/home-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.local/home-desktop.png', fullPage: true, animations: 'disabled' });
});

test('client-only library entry retains empty and failed recovery paths', async ({ page }) => {
  await page.route('**/episodes', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/<script id="public-data"[^>]*>[\s\S]*?<\/script>/, '');
    await route.fulfill({ response, body: html });
  });
  await page.route('**/api/episodes', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/episodes');
  await expect(page.getByRole('alert')).toContainText('节目暂时没有加载出来');
  await page.unroute('**/api/episodes');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('.episode-card')).toHaveCount(6);
  await page.route('**/api/episodes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ episodes: [] }) }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: '第一段声音，正在路上。' })).toBeVisible();
});

test('public content and episode links are readable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  for (const path of ['/', '/episodes', '/about', '/episodes/how-many-ai-tools-after-work']) {
    const response = await page.goto(`${baseURL}${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main h1:not(article h1)')).toBeVisible();
    await expect(page.getByRole('link', { name: '全部播客', exact: true }).first()).toBeVisible();
  }
  await expect(page.locator('#reading-panel')).toContainText('白天消息不停');
  await expect(page.locator('#reading-panel a').first()).toBeVisible();
  await context.close();
});

test('unknown URLs return 404 and real icons retain their media types', async ({ request }) => {
  for (const path of ['/feed', '/rss.xml', '/favicon.ico', '/episodes/missing-episode']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  expect((await request.get('/apple-touch-icon.png')).headers()['content-type']).toContain('image/png');
  expect((await request.get('/site.webmanifest')).status()).toBe(200);
});

test('public re-entry revalidates the server snapshot without a document reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.programme-group').first()).toBeVisible();
  await clickWhenHydrated(
    () => page.locator('footer a[href="/login"]').click(),
    () => expect(page).toHaveURL(/\/login$/),
  );
  await expect(page.getByRole('heading', { name: '欢迎回到工作室' })).toBeVisible();
  await page.route('**/api/episodes', (route) => route.fulfill({ json: { episodes: [] } }));
  await page.route('**/api/appearance', (route) =>
    route.fulfill({ json: { appearance: { theme: 'stillwood' } } }),
  );
  await page.route('**/api/site-seo', (route) =>
    route.fulfill({ json: { seo: { defaultTitle: 'Fresh public metadata' } } }),
  );
  await clickWhenHydrated(
    () => page.getByRole('link', { name: '返回网站' }).click(),
    () => expect(page.locator('.episode-card')).toHaveCount(0),
  );
  await expect(page.locator('.public-site')).toHaveAttribute('data-theme', 'stillwood');
  await expect(page).toHaveTitle('Fresh public metadata');
});
