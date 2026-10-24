import { expect, type Page, test } from '@playwright/test';
import { themeCoverFrameSrc, themeMedia, themes } from '../../src/brand/themes';
import { themeIds } from '../../src/shared/appearance';
import { episodeFixture, fixture } from '../worker/production-fixture';

const recentTitles = [5, 4, 3, 2].map((number) => `Library programme ${number}`);

async function catalogue(page: Page, options: { empty?: boolean; fail?: boolean } = {}) {
  const exports: URL[] = [];
  const writes: string[] = [];
  let failList = options.fail;
  let failImage = false;
  let failCategories = false;
  const episodes = [1, 2, 3, 4, 5].map((number) =>
    episodeFixture({
      id: `episode-${number}`,
      title: `Library programme ${number}`,
      episodeNumber: number,
      updatedAt: `2026-10-0${number}T00:00:00Z`,
    }),
  );
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
      return route.fulfill({ json: { productions: [fixture()] } });
    }
    if (url.pathname.endsWith('/episodes'))
      return route.fulfill({ json: { episodes: options.empty ? [] : episodes } });
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

async function expectCovers(page: Page) {
  await expect(page.locator('.appearance-cover-preview .framed-cover')).toHaveCount(32);
  for (const id of themeIds) {
    const strip = page.getByRole('region', { name: `${themes[id].name}近期节目封面`, exact: true });
    await expect(strip.locator('.appearance-cover-caption strong')).toHaveText(recentTitles);
    const cover = page.locator(`.appearance-cover-preview [data-cover-theme="${id}"]`);
    for (const item of await cover.all()) {
      await expect(item.locator('.framed-cover-image')).toHaveAttribute('src', 'https://f.no.mt/cover.png');
      await expect(item.locator('.framed-cover-overlay')).toHaveAttribute('src', themeCoverFrameSrc(id));
      await expect(item.locator('.framed-cover-copy')).toContainText('生活留白');
      await expect(item.locator('.framed-cover-image')).toHaveJSProperty('complete', true);
      expect(
        await item.locator('.framed-cover-image').evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBeGreaterThan(0);
    }
  }
}

test('theme catalogue composes the latest four library episodes even when productions have no covers', async ({
  page,
}) => {
  const state = await catalogue(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/admin');
  await expect(
    page
      .locator('.library-card')
      .filter({ has: page.locator('.framed-cover') })
      .locator('h2'),
  ).toHaveText([...recentTitles, 'Library programme 1']);
  await page.locator('[data-basalt-sidebar] [data-sidebar-row]').filter({ hasText: '品牌外观' }).click();
  await expectCovers(page);
  await expect(page.getByRole('combobox', { name: '封面预览节目' })).toHaveCount(0);
  await expect(page.getByText('真实节目封面', { exact: true })).toHaveCount(0);
  await expect(page.getByText('请先在节目制作中保存封面原图。', { exact: false })).toHaveCount(0);
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
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/brand/favicons/stillwood.svg',
  );
  await page.goBack();
  await expect(page.getByRole('radio', { name: '05 · 雾林来信', exact: true })).toBeChecked();
  await page.goForward();
  await page.reload();
  await expect(page.getByRole('radio', { name: '02 · 间隙', exact: true })).toBeChecked();
  await expectCovers(page);

  const trigger = page.getByRole('button', { name: '查看间隙封面：Library programme 5', exact: true });
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

test('an empty library stays empty without an upload prerequisite or design samples', async ({ page }) => {
  const state = await catalogue(page, { empty: true });
  await page.goto('/admin/appearance');
  await expect(page.locator('.appearance-cover-notice')).toHaveText(Array(8).fill('节目库暂无可预览的封面'));
  await expect(page.locator('.appearance-cover-preview .framed-cover')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '封面预览节目' })).toHaveCount(0);
  expect(state.exports).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('catalogue, category and original-image failures recover with an explicit refresh without exporting', async ({
  page,
}) => {
  const state = await catalogue(page, { fail: true });
  await page.goto('/admin/appearance');
  await expect(page.getByRole('alert')).toHaveText('Programme read failed');
  await expect(page.locator('.appearance-cover-notice')).toHaveText(
    Array(8).fill('节目库读取失败，请刷新预览'),
  );
  state.recoverList();
  state.failCategories(true);
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expect(page.getByRole('alert')).toHaveText('Category read failed');
  state.failCategories(false);
  state.failImage(true);
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expect(page.locator('.appearance-cover-placeholder')).toHaveText(
    Array(32).fill('图片读取失败，请刷新预览'),
  );
  state.failImage(false);
  await page.getByRole('button', { name: '刷新预览' }).click();
  await expectCovers(page);
  expect(state.exports).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('recent covers scroll horizontally without changing the theme or overflowing the page', async ({
  page,
}) => {
  const state = await catalogue(page);
  await page.goto('/admin/appearance');
  await expectCovers(page);
  const strip = page.getByRole('region', { name: '间隙近期节目封面', exact: true });
  for (const width of [1440, 1024, 393]) {
    await page.setViewportSize({ width, height: 900 });
    await strip.scrollIntoViewIfNeeded();
    await strip.evaluate((element) => {
      if (element.scrollLeft === 0) return;
      return new Promise<void>((resolve) => {
        element.addEventListener('scrollend', () => resolve(), { once: true });
        element.scrollTo({ left: 0, behavior: 'instant' });
      });
    });
    await strip.focus();
    const scrolled = await strip.evaluateHandle((element) => ({
      done: new Promise<void>((resolve) => {
        const finish = () => {
          if (element.scrollLeft <= 0) return;
          element.removeEventListener('scrollend', finish);
          resolve();
        };
        element.addEventListener('scrollend', finish);
      }),
    }));
    await page.keyboard.press('ArrowRight');
    await scrolled.evaluate(({ done }) => done);
    await scrolled.dispose();
    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByRole('radio', { name: '05 · 雾林来信', exact: true })).toBeChecked();
    for (const button of await strip.getByRole('button').all()) {
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    const last = strip.getByRole('button').last();
    await last.click();
    const dialog = page.getByRole('dialog', { name: '间隙 · 封面预览', exact: true });
    await expect(dialog.locator('.framed-cover-copy')).toContainText(/Library\s*programme 2/);
    await dialog.getByRole('button', { name: '关闭封面预览' }).click();
    await expect(last).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.admin-shell').evaluate((element) => element.scrollTop)).toBe(0);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(strip).toBeVisible();
  expect(state.exports).toEqual([]);
  expect(state.writes).toEqual([]);
});
