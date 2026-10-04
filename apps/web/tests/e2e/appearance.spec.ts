import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { themes } from '../../src/brand/themes';
import { type Appearance, themeIds } from '../../src/shared/appearance';

test('all eight previews load real artwork, inline identity and same-origin fonts on desktop and phone', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const writes: string[] = [];
  const fonts: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/appearance')) writes.push(request.url());
    if (request.resourceType() === 'font') fonts.push(request.url());
  });
  await mkdir('.local/appearance', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const id of themeIds) {
      await page.goto(`/?theme=${id}`);
      await expect(page.locator('.public-site')).toHaveAttribute('data-theme', id);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(themes[id].heading.join(''));
      await expect(page.locator('.site-header .brand-wordmark path')).toHaveCount(1);
      await expect(page.locator('.footer-wordmark .brand-wordmark path')).toHaveCount(1);
      await expect(page.locator('.brand-wordmark use')).toHaveCount(0);
      await expect
        .poll(() =>
          page.locator('.hero-visual img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${id} at ${width}px`,
      ).toBe(true);
      await page.screenshot({ path: `.local/appearance/${id}-${width}.png`, animations: 'disabled' });
    }
  }
  const family = await page.evaluate(async () => ({
    latin: (await document.fonts.load('500 24px "Space Grotesk"', 'his.fm')).length,
    chinese: (await document.fonts.load('500 24px "Noto Sans SC"', '间隙山林')).length,
  }));
  expect(family.latin).toBeGreaterThan(0);
  expect(family.chinese).toBeGreaterThan(0);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await page.getByRole('link', { name: '找一期，歇一会儿' }).click();
  await expect(page).toHaveURL(/\/episodes\?theme=alpine-bloom$/);
  await page.getByRole('link', { name: '退出预览' }).click();
  await expect(page).toHaveURL(/\/episodes$/);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('the owner can preview and apply a theme without changing production or concurrent local edits', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '进入本地工作室' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await page.getByRole('button', { name: '品牌外观', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: '网站视觉主题' })).toBeVisible();
  const before = await page.evaluate(
    async () =>
      ((await (await fetch('/admin/api/appearance')).json()) as { appearance: Appearance }).appearance,
  );
  const selected = before.theme === 'stillwood' ? 'interval' : 'stillwood';
  let written: Appearance | undefined;
  const publicPage = await context.newPage();
  try {
    await page
      .getByRole('radio', { name: `${themes[selected].number} · ${themes[selected].name}`, exact: true })
      .click();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: '预览所选风格' }).click();
    const preview = await popupPromise;
    await expect(preview.locator('.public-site')).toHaveAttribute('data-theme', selected);
    await expect(preview.getByLabel('外观预览')).toBeVisible();
    await preview.close();
    expect(
      await page.evaluate(
        async () =>
          ((await (await fetch('/admin/api/appearance')).json()) as { appearance: Appearance }).appearance,
      ),
    ).toEqual(before);
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/admin/api/appearance' && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '应用到公开网站' }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    written = (await response.json()).appearance;
    await expect(page.getByRole('button', { name: '应用到公开网站' })).toBeDisabled();
    await publicPage.goto('/');
    await expect(publicPage.locator('.public-site')).toHaveAttribute('data-theme', selected);
    expect(await publicPage.evaluate(async () => await (await fetch('/api/appearance')).json())).toEqual({
      appearance: { theme: selected },
    });
  } finally {
    if (written) {
      const restored = await page.evaluate(
        async ({ before, written }) => {
          const current = (
            (await (await fetch('/admin/api/appearance')).json()) as { appearance: Appearance }
          ).appearance;
          if (current.version !== written.version || current.theme !== written.theme)
            return 'concurrent-edit';
          const response = await fetch('/admin/api/appearance', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: before.theme, version: written.version }),
          });
          return response.status;
        },
        { before, written },
      );
      expect([200, 409, 'concurrent-edit']).toContain(restored);
    }
    await publicPage.close();
  }
});

test('failed saves preserve selection and conflicts require an explicit reload', async ({ page }) => {
  let saved: Appearance = { theme: 'interval', version: 1, updatedAt: '', updatedBy: 'owner' };
  let failure = 503;
  await page.route('**/admin/api/session', (route) =>
    route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } }),
  );
  await page.route('**/admin/api/appearance', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: failure, json: { error: failure === 409 ? '外观已被更新' : '连接暂时中断' } })
      : route.fulfill({ json: { appearance: saved } }),
  );
  await page.goto('/admin/appearance');
  await page.getByRole('radio', { name: '01 · 林间电台', exact: true }).click();
  await page.getByRole('button', { name: '应用到公开网站' }).click();
  await expect(page.getByRole('alert')).toContainText('连接暂时中断');
  await expect(page.getByRole('radio', { name: '01 · 林间电台', exact: true })).toBeChecked();
  failure = 409;
  await page.getByRole('button', { name: '应用到公开网站' }).click();
  await expect(page.getByRole('button', { name: '应用到公开网站' })).toBeDisabled();
  saved = { ...saved, theme: 'stillwood', version: 2 };
  await page.getByRole('button', { name: '读取最新设置' }).click();
  const current = page.getByRole('radio', { name: '05 · 雾林来信', exact: true });
  await expect(current).toBeChecked();
  await current.focus();
  await page.keyboard.down('ArrowDown');
  await expect(page.getByRole('radio', { name: '06 · 岛屿时间', exact: true })).toBeChecked();
  await page.keyboard.up('ArrowDown');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/appearance/admin-mobile-dark.png', fullPage: true });
});
