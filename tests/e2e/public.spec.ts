import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('listeners can browse, filter and read the complete first episode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('世界很快');
  await expect(page.locator('.episode-card')).toHaveCount(3);
  await page.getByRole('link', { name: '找一期，歇一会儿' }).click();
  await expect(page).toHaveURL(/\/episodes$/);
  await expect(page.locator('.episode-card')).toHaveCount(6);
  await page.getByRole('button', { name: '生活留白', exact: true }).click();
  await expect(page.locator('.episode-card')).toHaveCount(2);
  await page.getByRole('searchbox', { name: '搜索播客' }).fill('不存在的关键词');
  await expect(page.getByRole('heading', { name: '还没聊到这个话题。' })).toBeVisible();
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索播客' }).fill('AI 学习');
  await expect(page.locator('.episode-card')).toHaveCount(1);
  await page.getByRole('link', { name: '下班后，还要追多少个 AI？', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('下班后，还要追多少个 AI？');
  await expect(page.getByText('声音正在准备中')).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.getByRole('tab', { name: '逐字稿' }).click();
  await expect(page.getByRole('tab', { name: '逐字稿' })).toHaveAttribute('aria-selected', 'true');
  expect((await page.getByRole('tabpanel').innerText()).length).toBeGreaterThan(2400);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('下班后，还要追多少个 AI？');
  await page.goto('/episodes/missing-episode');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('别的频道');
  expect(errors).toEqual([]);
});

test('public pages fit a phone and respect reduced motion', async ({ page }) => {
  await mkdir('.local', { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.episode-card')).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden();
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '关于 his.fm' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('his.fm');
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden();
  for (const path of ['/', '/episodes', '/episodes/how-many-ai-tools-after-work', '/about']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, `${path} fits the viewport`).toBe(true);
  }
  await page.goto('/');
  await expect(page.locator('.episode-card')).toHaveCount(3);
  expect(
    await page.locator('.ticker > div').evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.screenshot({ path: '.local/home-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.local/home-desktop.png', fullPage: true, animations: 'disabled' });
});

test('empty and failed libraries provide useful recovery paths', async ({ page }) => {
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
