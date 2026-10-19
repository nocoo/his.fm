import { expect, type Page, test } from '@playwright/test';
import { themeMedia, themes } from '../../src/brand/themes';
import { themeIds } from '../../src/shared/appearance';
import { readyFixture } from '../worker/production-fixture';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=',
  'base64',
);

async function catalogue(page: Page, options: { empty?: boolean; fail?: boolean } = {}) {
  const calls: URL[] = [];
  const writes: string[] = [];
  let active = 0;
  let maximum = 0;
  let failList = options.fail;
  let failCover = options.fail;
  const productions = [
    readyFixture({ id: 'current', title: 'Current saved programme', version: 7 }),
    readyFixture({ id: 'second', title: 'Second saved programme', version: 9 }),
  ];
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') writes.push(url.pathname);
    if (url.pathname.endsWith('/session'))
      return route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } });
    if (url.pathname.endsWith('/appearance'))
      return route.fulfill({
        json: { appearance: { theme: 'stillwood', version: 2, updatedAt: '', updatedBy: 'owner' } },
      });
    if (url.pathname.endsWith('/productions')) {
      if (failList) {
        return route.fulfill({ status: 503, json: { error: 'Programme read failed' } });
      }
      return route.fulfill({ json: { productions: options.empty ? [] : productions } });
    }
    if (url.pathname.endsWith('/cover.png')) {
      calls.push(url);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      if (failCover) {
        failCover = false;
        return route.fulfill({ status: 503, json: { error: 'Cover render busy' } });
      }
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected API' } });
  });
  return {
    calls,
    writes,
    maximum: () => maximum,
    recoverList: () => {
      failList = false;
    },
  };
}

test('theme catalogue shows design details and serial real-cover API requests for the selected programme', async ({
  page,
}) => {
  const state = await catalogue(page);
  await page.goto('/admin/appearance');
  await expect(page.locator('.appearance-cover-preview img')).toHaveCount(8);
  for (const id of themeIds) {
    const card = page.locator('.appearance-option').filter({ has: page.locator(`[data-theme="${id}"]`) });
    await expect(card.locator('.appearance-description')).toHaveText(themes[id].description);
    await expect(card.locator('.mini-heading')).toHaveText(themes[id].designSlogan);
    await expect(card.locator('.appearance-english')).toContainText(themes[id].designStyle);
    await expect(card.locator('.appearance-mini img')).toHaveAttribute('src', themeMedia[id].hero);
    await expect(card.locator('.appearance-palette code')).toHaveText(themes[id].palette);
    await expect(card.getByRole('link', { name: '预览此主题网站' })).toHaveAttribute('href', `/?theme=${id}`);
    await expect(card.locator('.appearance-cover-preview img')).toHaveAttribute('src', /^blob:/);
  }
  expect(state.calls.map((url) => url.searchParams.get('theme'))).toEqual(themeIds);
  expect(
    state.calls.every((url) => url.pathname.includes('/current/') && url.searchParams.get('version') === '7'),
  ).toBe(true);
  await page.getByRole('radio', { name: '02 · 间隙', exact: true }).click();
  expect(state.calls).toHaveLength(8);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/brand/favicons/stillwood.svg');
  await page.getByRole('combobox', { name: '封面预览节目' }).click();
  await page.getByRole('option', { name: /Second saved programme/ }).click();
  await expect(page.locator('.appearance-cover-preview img')).toHaveCount(8);
  await expect(page.locator('.appearance-cover-caption strong')).toHaveText(
    Array(8).fill('Second saved programme'),
  );
  expect(
    state.calls
      .slice(8)
      .every((url) => url.pathname.includes('/second/') && url.searchParams.get('version') === '9'),
  ).toBe(true);
  expect(state.calls).toHaveLength(16);
  expect(state.maximum()).toBe(1);
  expect(state.writes).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const hero = page.locator('.appearance-mini').first();
  await hero.hover();
  await expect(hero.locator('img')).toHaveCSS('transform', 'matrix(1.06, 0, 0, 1.06, 0, 0)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hero.locator('img')).toHaveCSS('transform', 'none');
});

test('empty projects never substitute archived sample covers or seeded episode data', async ({ page }) => {
  const state = await catalogue(page, { empty: true });
  await page.goto('/admin/appearance');
  await expect(page.locator('.appearance-preview-notice')).toContainText('不使用演示数据替代');
  await expect(page.locator('.appearance-cover-placeholder')).toHaveCount(8);
  await expect(page.locator('.appearance-cover-preview img')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '封面预览节目' })).toHaveCount(0);
  expect(state.calls).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('catalogue and cover errors remain visible and an explicit refresh recovers without saving', async ({
  page,
}) => {
  const state = await catalogue(page, { fail: true });
  await page.goto('/admin/appearance');
  await expect(page.getByRole('alert')).toHaveText('Programme read failed');
  await expect(page.locator('.appearance-cover-placeholder')).toHaveText(
    Array(8).fill('节目读取失败，请刷新预览'),
  );
  await expect(page.getByText('暂无真实封面', { exact: true })).toHaveCount(0);
  state.recoverList();
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expect(page.locator('.appearance-cover-placeholder').first()).toHaveText('Cover render busy');
  await expect(page.locator('.appearance-cover-preview img')).toHaveCount(7);
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expect(page.locator('.appearance-cover-preview img')).toHaveCount(8);
  await expect(page.locator('.appearance-cover-placeholder')).toHaveCount(0);
  expect(state.maximum()).toBe(1);
  expect(state.writes).toEqual([]);
});
