import { expect, type Locator, test } from '@playwright/test';
import { themeFaviconSrc, themes } from '../../src/brand/themes';
import { type Appearance, themeIds } from '../../src/shared/appearance';

function rgb(hex: string) {
  return `rgb(${hex
    .slice(1)
    .match(/../g)
    ?.map((part) => parseInt(part, 16))
    .join(', ')})`;
}

async function expectLockup(lockup: Locator, color: string) {
  await expect(lockup.locator('> svg').nth(0)).toHaveClass(/brand-wordmark/);
  await expect(lockup.locator('> svg').nth(1)).toHaveClass(/brand-symbol/);
  await expect(lockup.locator('.brand-wordmark')).toHaveCSS('color', color);
  await expect(lockup.locator('.brand-symbol')).toHaveCSS('color', color);
  const geometry = await lockup.evaluate((element) => {
    const word = element.querySelector('.brand-wordmark')?.getBoundingClientRect();
    const mark = element.querySelector('.brand-symbol')?.getBoundingClientRect();
    if (!word || !mark) throw new Error('Missing canonical ID');
    return {
      word: word.width,
      wordHeight: word.height,
      mark: mark.width,
      height: mark.height,
      gap: mark.left - word.right,
      center: Math.abs(mark.top + mark.height / 2 - word.top - word.height / 2),
    };
  });
  expect(geometry.word).toBeCloseTo(116, 1);
  expect(geometry.mark).toBeCloseTo(geometry.wordHeight, 1);
  expect(geometry.height).toBeCloseTo(geometry.wordHeight, 1);
  expect(geometry.gap).toBeCloseTo(8, 1);
  expect(geometry.center).toBeLessThan(1);
}

test('all theme cards and studio headers share the canonical ID in light and dark layouts', async ({
  page,
}, testInfo) => {
  const writes: string[] = [];
  await page.route('**/admin/api/**', (route) => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(request.url());
    if (request.url().endsWith('/session'))
      return route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } });
    if (request.url().endsWith('/appearance'))
      return route.fulfill({
        json: { appearance: { theme: 'interval', version: 1, updatedAt: '', updatedBy: 'owner' } },
      });
    return route.fulfill({ status: 404, json: { error: 'Unexpected API' } });
  });
  await page.goto('/admin/appearance');
  for (const mode of ['light', 'dark']) {
    await page.evaluate((theme) => {
      localStorage.setItem('hisfm-theme', theme);
    }, mode);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(new RegExp(mode));
    for (const width of [1440, 1024, 393]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('.appearance-option')).toHaveCount(8);
      await expectLockup(
        page.locator('.identity-specimen .brand-lockup'),
        mode === 'dark' ? 'rgb(255, 255, 255)' : rgb(themes.interval.palette[1]),
      );
      if (width === 1440) {
        await expectLockup(
          page.locator('.admin-rail-mark .brand-lockup'),
          mode === 'dark' ? 'rgb(255, 255, 255)' : rgb(themes.interval.palette[1]),
        );
        const header = page.locator('.admin-rail-header');
        expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      for (const id of themeIds) {
        const dark = ['grove', 'stillwood', 'window-seat'].includes(id);
        await expectLockup(
          page.locator(`.appearance-mini[data-theme="${id}"] .brand-lockup`),
          dark ? 'rgb(255, 255, 255)' : rgb(themes[id].palette[1]),
        );
      }
      const sizes = await page.locator('.appearance-option').evaluateAll((cards) =>
        cards.map((card) => {
          const size = (selector: string) =>
            getComputedStyle(card.querySelector(selector) as Element).fontSize;
          return {
            slogan: size('.mini-heading'),
            title: size('.appearance-choice strong'),
            english: size('.appearance-english'),
          };
        }),
      );
      expect(new Set(sizes.map((size) => size.slogan)).size).toBe(1);
      expect(new Set(sizes.map((size) => size.title)).size).toBe(1);
      expect(new Set(sizes.map((size) => size.english)).size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`identity-${mode}-${width}.png`),
        animations: 'disabled',
      });
    }
  }
  expect(writes).toEqual([]);
});

test('public header IDs and favicons follow previews across navigation and return to the saved theme', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const saved = (await (await page.request.get('/api/appearance')).json()) as { appearance: Appearance };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    for (const id of themeIds) {
      await page.goto(`/?theme=${id}`);
      const dark = ['stillwood', 'window-seat'].includes(id);
      await expectLockup(
        page.locator('.site-header .brand-lockup'),
        dark ? 'rgb(255, 255, 255)' : rgb(themes[id].palette[1]),
      );
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc(id));
      const icon = await page.request.get(themeFaviconSrc(id));
      expect(icon.ok()).toBe(true);
      expect(icon.headers()['content-type']).toContain('image/svg+xml');
      expect(await icon.text()).toContain('color="#ffffff"');
      await page.getByRole('link', { name: '找一期，歇一会儿' }).click();
      await expect(page).toHaveURL(new RegExp(`/episodes\\?theme=${id}$`));
      await expectLockup(page.locator('.site-header .brand-lockup'), rgb(themes[id].palette[1]));
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc(id));
    }
    await page.screenshot({
      path: testInfo.outputPath(`public-identity-${width}.png`),
      animations: 'disabled',
    });
  }
  await page.getByRole('link', { name: '退出预览' }).click();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    'href',
    themeFaviconSrc(saved.appearance.theme),
  );
  expect(errors).toEqual([]);
});

test('studio favicon changes only after a successful apply, independently of the Basalt color mode', async ({
  page,
}) => {
  let saved: Appearance = { theme: 'interval', version: 1, updatedAt: '', updatedBy: 'owner' };
  await page.route('**/admin/api/session', (route) =>
    route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } }),
  );
  await page.route('**/admin/api/appearance', (route) => {
    if (route.request().method() === 'PUT')
      saved = { ...saved, ...route.request().postDataJSON(), version: saved.version + 1 };
    return route.fulfill({ json: { appearance: saved } });
  });
  await page.goto('/admin/appearance');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc('interval'));
  await page.getByRole('radio', { name: '05 · 雾林来信', exact: true }).click();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc('interval'));
  await page.getByRole('button', { name: '应用到公开网站' }).click();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc('stillwood'));
  await expectLockup(page.locator('.admin-rail-mark .brand-lockup'), rgb(themes.stillwood.palette[1]));
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expectLockup(page.locator('.admin-rail-mark .brand-lockup'), 'rgb(255, 255, 255)');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc('stillwood'));
});
