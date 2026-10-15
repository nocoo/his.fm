import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'no-preference', viewport: { width: 1280, height: 720 } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/episodes', (route) => route.fulfill({ json: { episodes: [] } }));
});

test('public sections reveal once on entering the viewport and survive navigation', async ({ page }) => {
  await page.goto('/?theme=interval');
  const section = page.locator('.about-teaser-copy');
  await expect(section).toHaveCSS('opacity', '0');
  await expect(section).toHaveCSS('transition-duration', '0.65s, 0.65s');
  await section.scrollIntoViewIfNeeded();
  await expect(section).toHaveAttribute('data-revealed', '');
  await expect(section).toHaveCSS('opacity', '1');
  await expect(section).toHaveCSS('transform', 'none');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(section).toHaveCSS('opacity', '1');
  await section.scrollIntoViewIfNeeded();
  expect(await section.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '关于 his.fm' }).click();
  await expect(page.locator('.about-opening .public-reveal')).toHaveAttribute('data-revealed', '');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('reduced motion shows offscreen sections immediately and does not hide them again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?theme=interval');
  const section = page.locator('.about-teaser-copy');
  await expect(section).toHaveAttribute('data-revealed', '');
  await expect(section).toHaveCSS('opacity', '1');
  await expect(section).toHaveCSS('transform', 'none');
  await expect(section).toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(section).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '关于 his.fm' }).click();
  await expect(page.locator('.about-opening .public-reveal')).toHaveAttribute('data-revealed', '');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('changing motion preference and keyboard focus reveal pending content', async ({ page }) => {
  await page.goto('/?theme=interval');
  const section = page.locator('.about-teaser-copy');
  await expect(section).toHaveCSS('opacity', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(section).toHaveAttribute('data-revealed', '');
  await expect(section).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(section).toHaveCSS('opacity', '1');
  await page.reload();
  await expect(section).toHaveCSS('opacity', '0');
  await section
    .getByRole('link')
    .evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await expect(section).toHaveAttribute('data-revealed', '');
  await expect(section).toHaveCSS('opacity', '1');
});
