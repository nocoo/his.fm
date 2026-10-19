import { expect, type Page, test } from '@playwright/test';
import { themeCoverFrameSrc, themeMedia, themes } from '../../src/brand/themes';
import { themeIds } from '../../src/shared/appearance';
import { readyFixture } from '../worker/production-fixture';

async function catalogue(page: Page, options: { empty?: boolean; fail?: boolean } = {}) {
  const exports: URL[] = [];
  const writes: string[] = [];
  let failList = options.fail;
  let failImage = false;
  let failCategories = false;
  const productions = [
    readyFixture({ id: 'current', title: 'Current saved programme', version: 7 }),
    readyFixture({ id: 'second', title: 'Second saved programme', version: 9 }),
  ];
  await page.route('https://f.no.mt/cover.png', (route) =>
    failImage
      ? route.fulfill({ status: 503, body: '' })
      : route.fulfill({
          contentType: 'image/webp',
          path: 'public/images/episode-01.webp',
        }),
  );
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
      if (failList) return route.fulfill({ status: 503, json: { error: 'Programme read failed' } });
      return route.fulfill({ json: { productions: options.empty ? [] : productions } });
    }
    if (url.pathname.endsWith('/categories')) {
      if (failCategories) return route.fulfill({ status: 503, json: { error: 'Category read failed' } });
      return route.fulfill({ json: { categories: [{ id: 'life', name: '生活留白' }] } });
    }
    if (url.pathname.endsWith('/cover.png')) exports.push(url);
    return route.fulfill({ status: 404, json: { error: 'Unexpected API' } });
  });
  return {
    exports,
    writes,
    recoverList: () => {
      failList = false;
    },
    failImage: (value: boolean) => {
      failImage = value;
    },
    failCategories: (value: boolean) => {
      failCategories = value;
    },
  };
}

async function expectCovers(page: Page, title: string) {
  await expect(page.locator('.appearance-cover-preview .framed-cover')).toHaveCount(8);
  await expect(page.locator('.appearance-cover-caption strong')).toHaveText(Array(8).fill(title));
  for (const id of themeIds) {
    const cover = page.locator(`.appearance-cover-preview [data-cover-theme="${id}"]`);
    await expect(cover.locator('.framed-cover-image')).toHaveAttribute('src', 'https://f.no.mt/cover.png');
    await expect(cover.locator('.framed-cover-overlay')).toHaveAttribute('src', themeCoverFrameSrc(id));
    await expect(cover.locator('.framed-cover-copy')).toContainText('生活留白');
    expect(
      await cover
        .locator('.framed-cover-image')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    ).toBe(true);
  }
}

test('theme catalogue composes real cover data immediately and preserves selections in URL history', async ({
  page,
}) => {
  const state = await catalogue(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/admin/appearance');
  await expectCovers(page, 'Current saved programme');
  for (const id of themeIds) {
    const card = page.locator('.appearance-option').filter({ has: page.locator(`[data-theme="${id}"]`) });
    await expect(card.locator('.appearance-description')).toHaveText(themes[id].description);
    await expect(card.locator('.mini-heading')).toHaveText(themes[id].designSlogan);
    await expect(card.locator('.appearance-english')).toContainText(themes[id].designStyle);
    await expect(card.locator('.appearance-mini img')).toHaveAttribute('src', themeMedia[id].hero);
    await expect(card.locator('.appearance-palette code')).toHaveText(themes[id].palette);
    await expect(card.getByRole('link', { name: '预览此主题网站' })).toHaveAttribute('href', `/?theme=${id}`);
  }
  await page.getByRole('radio', { name: '02 · 间隙', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/appearance\?theme=interval$/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/brand/favicons/stillwood.svg');
  await page.getByRole('combobox', { name: '封面预览节目' }).click();
  await page.getByRole('option', { name: /Second saved programme/ }).click();
  await expect(page).toHaveURL(/theme=interval&production=second$/);
  await expectCovers(page, 'Second saved programme');
  await page.goBack();
  await expectCovers(page, 'Current saved programme');
  await page.goBack();
  await expect(page.getByRole('radio', { name: '05 · 雾林来信', exact: true })).toBeChecked();
  await page.goForward();
  await page.goForward();
  await page.reload();
  await expect(page.getByRole('radio', { name: '02 · 间隙', exact: true })).toBeChecked();
  await expectCovers(page, 'Second saved programme');

  const trigger = page.getByRole('button', { name: '查看间隙封面大图', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '间隙 · 封面预览', exact: true });
  await expect(dialog.locator('[data-cover-theme="interval"]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '关闭封面预览' })).toBeFocused();
  await dialog.getByRole('button', { name: '关闭封面预览' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const hero = page.locator('.appearance-mini').first();
  await hero.hover();
  await expect(hero.locator('img')).toHaveCSS('transform', 'matrix(1.06, 0, 0, 1.06, 0, 0)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hero.locator('img')).toHaveCSS('transform', 'none');
  expect(state.exports).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('empty projects and unavailable deep links never substitute archived samples or other projects', async ({
  page,
}) => {
  const state = await catalogue(page, { empty: true });
  await page.goto('/admin/appearance');
  await expect(page.locator('.appearance-preview-notice')).toContainText('不使用演示数据替代');
  await expect(page.locator('.appearance-cover-placeholder')).toHaveCount(8);
  await expect(page.locator('.appearance-cover-preview .framed-cover')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '封面预览节目' })).toHaveCount(0);
  await page.goto('/admin/appearance?production=missing');
  await expect(page.getByRole('alert')).toContainText('所选制作项目不存在');
  await expect(page.locator('.appearance-cover-preview .framed-cover')).toHaveCount(0);
  expect(state.exports).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('catalogue, category and original-image failures recover with an explicit refresh without exporting', async ({
  page,
}) => {
  const state = await catalogue(page, { fail: true });
  await page.goto('/admin/appearance');
  await expect(page.getByRole('alert')).toHaveText('Programme read failed');
  await expect(page.locator('.appearance-cover-placeholder')).toHaveText(
    Array(8).fill('节目读取失败，请刷新预览'),
  );
  state.recoverList();
  state.failCategories(true);
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expect(page.getByRole('alert')).toHaveText('Category read failed');
  state.failCategories(false);
  state.failImage(true);
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expect(page.locator('.appearance-cover-placeholder')).toHaveText(
    Array(8).fill('图片读取失败，请刷新预览'),
  );
  state.failImage(false);
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expectCovers(page, 'Current saved programme');
  expect(state.exports).toEqual([]);
  expect(state.writes).toEqual([]);
});
