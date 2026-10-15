import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { themes } from '../../src/brand/themes';
import type { PublicAppearance } from '../../src/shared/appearance';

async function login(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '欢迎回到工作室' })).toBeVisible();
  await page.getByRole('button', { name: '进入本地工作室' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await page.goto('/admin/catalog');
  await expect(page.getByRole('table', { name: '播客节目列表' })).toBeVisible();
}

async function responseStatus(page: Page, path: string, method = 'GET') {
  return page.evaluate(async ({ path, method }) => (await fetch(path, { method })).status, { path, method });
}

async function browserCanvas(page: Page) {
  return page.evaluate(() => ({
    theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    root: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    shell: getComputedStyle(document.querySelector('.admin-shell') ?? document.body).backgroundColor,
  }));
}

test('editor can create, edit, publish, delete and log out', async ({ page, browser }) => {
  const slug = `e2e-${randomUUID()}`;
  const title = `验收专用节目 ${slug}`;
  const editedTitle = `验收后的节目 ${slug}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let id: string | undefined;
  await mkdir('.local', { recursive: true });
  await login(page);
  const origin = new URL(page.url()).origin;
  const publicContext = await browser.newContext({ baseURL: origin });
  const publicPage = await publicContext.newPage();
  try {
    await publicPage.goto('/');
    await page.screenshot({ path: '.local/admin-desktop.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('link', { name: '新建节目', exact: true }).click();
    await page.getByLabel('节目标题', { exact: true }).fill(title);
    await page.getByLabel('摘要', { exact: true }).fill('端到端验收使用的临时节目，测试结束会自动清理。');
    await page
      .getByLabel('逐字稿', { exact: true })
      .fill('你好，欢迎收听 his.fm。这是自动化验收专用的测试文稿。');
    await page.getByLabel('节目笔记', { exact: true }).fill('测试来源：本地浏览器验收。');
    await page.getByLabel('期数', { exact: true }).fill('99001');
    await page.getByLabel('链接名称', { exact: true }).fill(slug);
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/admin/api/episodes' && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '保存节目', exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const result = await created.json();
    id = result.episode.id;
    await expect(page).toHaveURL(new RegExp(`/admin/episodes/${id}$`));
    await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue(title);
    expect(await responseStatus(publicPage, `/api/episodes/${slug}`)).toBe(404);

    await page.getByLabel('节目标题', { exact: true }).fill(editedTitle);
    const update = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/admin/api/episodes/${id}`) && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '保存节目', exact: true }).click();
    expect((await update).status()).toBe(200);
    await expect(page.getByText('所有改动已保存。')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue(editedTitle);
    await page.getByRole('combobox', { name: '发布状态' }).click();
    await page.getByRole('option', { name: '发布 · 所有人可见' }).click();
    await page.getByLabel('发布时间', { exact: true }).fill('2026-09-25T12:30');
    const publication = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/admin/api/episodes/${id}`) && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '保存节目', exact: true }).click();
    expect((await publication).status()).toBe(200);
    await expect(page.getByRole('link', { name: '查看页面' })).toBeVisible();
    await page.screenshot({ path: '.local/admin-editor.png', fullPage: true, animations: 'disabled' });
    await publicPage.goto(`/episodes/${slug}`);
    await expect(publicPage.getByRole('heading', { name: editedTitle, exact: true })).toBeVisible();
    await expect(publicPage.locator('audio')).toHaveCount(0);

    await page.getByRole('link', { name: '节目库', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索节目' }).fill(slug);
    await expect(page.getByRole('link', { name: editedTitle, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `删除 ${editedTitle}`, exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    const deletion = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/admin/api/episodes/${id}` &&
        response.request().method() === 'DELETE',
    );
    await page.getByRole('button', { name: '确认删除' }).click();
    expect((await deletion).status()).toBe(204);
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(page.getByRole('link', { name: editedTitle, exact: true })).toHaveCount(0);
    expect(await responseStatus(publicPage, `/api/episodes/${slug}`)).toBe(404);
    id = undefined;
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await responseStatus(page, '/admin/api/session')).toBe(401);
    expect(errors).toEqual([]);
  } finally {
    try {
      if (id) {
        const remaining = await page.evaluate(async (id) => {
          const path = `/admin/api/episodes/${id}`;
          const read = await fetch(path);
          if (read.status === 404) return 404;
          const { episode } = (await read.json()) as { episode: { version: number } };
          return (await fetch(`${path}?version=${episode.version}`, { method: 'DELETE' })).status;
        }, id);
        expect([204, 404]).toContain(remaining);
      }
    } finally {
      await publicContext.close();
    }
  }
});

test.describe('phone workspace', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('navigation closes, restores focus and the theme persists', async ({ page }) => {
    await login(page);
    const light = await browserCanvas(page);
    expect(light).toMatchObject({
      theme: light.shell,
      root: light.shell,
      body: light.shell,
      scheme: 'light',
    });
    await mkdir('.local', { recursive: true });
    const menu = page.getByRole('button', { name: '打开导航', exact: true });
    await menu.click();
    const drawer = page.getByRole('dialog', { name: '工作室导航' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: '新建制作', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/productions\/new$/);
    await expect(menu).toBeFocused();
    await menu.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hisfm-theme'))).toBe('light');
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(async () => (await browserCanvas(page)).scheme).toBe('dark');
    const dark = await browserCanvas(page);
    expect(dark).toMatchObject({ theme: dark.shell, root: dark.shell, body: dark.shell });
    expect(dark.root).not.toBe(light.root);
    await page.screenshot({ path: '.local/admin-mobile-dark.png', fullPage: true, animations: 'disabled' });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(async () => (await browserCanvas(page)).theme).toBe(dark.root);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await menu.click();
    await drawer.getByRole('link', { name: 'his.fm 首页', exact: true }).click();
    await expect(page.locator('.public-site')).toBeVisible();
    const selected = await page.evaluate(
      async () =>
        ((await (await fetch('/api/appearance')).json()) as { appearance: PublicAppearance }).appearance,
    );
    const paper = themes[selected.theme].palette[0];
    const rgb = `rgb(${[1, 3, 5].map((offset) => Number.parseInt(paper.slice(offset, offset + 2), 16)).join(', ')})`;
    expect(await browserCanvas(page)).toMatchObject({
      theme: paper,
      root: rgb,
      body: rgb,
      scheme: 'light',
    });
    await page.goBack();
    await expect(page.locator('.admin-shell')).toBeVisible();
    await expect.poll(async () => (await browserCanvas(page)).theme).toBe(dark.root);
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.screenshot({ path: '.local/admin-mobile-light.png', fullPage: true, animations: 'disabled' });
  });
});
