import { expect, test } from '@playwright/test';
import { fixture } from '../worker/production-fixture';

test.beforeEach(async ({ page }) => {
  await page.route('**/admin/api/**', (route) => {
    expect(route.request().method()).toBe('GET');
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/session')
      ? { mode: 'local', user: { email: 'editor@his.fm' } }
      : path.endsWith('/appearance')
        ? { appearance: { theme: 'stillwood', version: 1 } }
        : path.endsWith('/productions/production-test')
          ? { production: fixture() }
          : path.endsWith('/productions')
            ? { productions: [fixture()] }
            : path.endsWith('/episodes')
              ? { episodes: [] }
              : path.endsWith('/categories')
                ? { categories: [{ id: 'life', name: '生活留白', icon: 'leaf', color: 'amber' }] }
                : { error: 'Unexpected read' };
    return route.fulfill({ json });
  });
});

test('studio breadcrumbs and address paths follow navigation, reload and browser history', async ({
  page,
}) => {
  await page.goto('/admin');
  const crumbs = page.getByRole('navigation', { name: '面包屑导航', exact: true });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('节目库');
  await page.locator('[data-basalt-sidebar] [data-sidebar-row]').filter({ hasText: '品牌外观' }).click();
  await expect(page).toHaveURL(/\/admin\/appearance$/);
  await expect(crumbs.getByRole('link', { name: '工作室', exact: true })).toHaveAttribute('href', '/admin');
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('品牌外观');
  await page.reload();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('品牌外观');
  await page.locator('[data-basalt-sidebar]').getByRole('button', { name: '栏目管理', exact: true }).click();
  await page.getByRole('link', { name: '新建栏目', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/categories\/new$/);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('新建栏目');
  await crumbs.getByRole('link', { name: '栏目管理', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/categories$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/categories\/new$/);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('新建栏目');
  await page.goForward();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('栏目管理');
  await crumbs.getByRole('link', { name: '工作室', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test('studio shell stays mounted while a lazy route loads', async ({ page }) => {
  let releasePage = () => {};
  const pendingPage = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  await page.route(
    /\/(?:src\/admin\/appearance\/AppearancePage\.tsx|assets\/AppearancePage-[^/]+\.js)(?:\?|$)/,
    async (route) => {
      await pendingPage;
      await route.continue();
    },
  );
  await page.goto('/admin');
  const shell = page.locator('.admin-shell');
  await expect(shell).toBeVisible();
  const shellIdentity = await shell.evaluate((element) => {
    element.setAttribute('data-shell-identity', 'mounted');
    return element.getAttribute('data-shell-identity');
  });
  await page.locator('[data-basalt-sidebar] [data-sidebar-row]').filter({ hasText: '品牌外观' }).click();
  await expect(page).toHaveURL(/\/admin\/appearance$/);
  const loading = page.locator('.admin-route-loading');
  await expect(loading).toHaveCSS('position', 'absolute');
  await expect(shell).toHaveAttribute('data-shell-identity', shellIdentity ?? '');
  await expect(page.getByRole('navigation', { name: '工作室导航' })).toBeVisible();
  releasePage();
  await expect(page.getByRole('heading', { name: '品牌外观' })).toBeVisible();
  await expect(shell).toHaveAttribute('data-shell-identity', shellIdentity ?? '');
});

test('visit site uses the first full-width sidebar row in both rail states', async ({ page }) => {
  await page.goto('/admin');
  const nav = page.getByRole('navigation', { name: '工作室导航' });
  const firstRow = nav.locator('[data-sidebar-row]').first();
  await expect(firstRow).toContainText('访问网站');
  await expect(firstRow).toHaveAttribute('href', '/');
  await expect(firstRow).toHaveClass(/bg-basalt-primary/);
  await expect(firstRow).toHaveClass(/text-basalt-primary-foreground/);
  await page.getByRole('button', { name: '收起导航' }).click();
  const iconLink = nav.getByRole('link', { name: '访问网站' });
  await expect(iconLink).toHaveAttribute('href', '/');
  const toggleBox = await page.getByRole('button', { name: '展开导航' }).boundingBox();
  const siteBox = await iconLink.boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(siteBox).not.toBeNull();
  expect(siteBox?.y).toBeGreaterThanOrEqual((toggleBox?.y ?? 0) + (toggleBox?.height ?? 0));
});

test('production paths and breadcrumb ancestors preserve drafts and fit phone headers', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/admin/productions/production-test?section=metadata');
  const crumbs = page.getByRole('navigation', { name: '面包屑导航', exact: true });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('资料与素材');
  await page.getByLabel('节目标题', { exact: true }).fill('Unsaved navigation draft');
  await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
  await expect(page).toHaveURL(/\?section=manuscript$/);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('逐字稿');
  await page.goBack();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('资料与素材');
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('Unsaved navigation draft');
  await page.getByRole('button', { name: '打开素材 1：观察笔记', exact: true }).click();
  await expect(page).toHaveURL(/source=source-1/);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('素材详情');
  await expect(crumbs.locator('[aria-current="page"]')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.admin-shell').evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole('button', { name: '打开导航', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(crumbs.getByRole('link', { name: '节目库', exact: true })).toBeFocused();
  await crumbs.getByRole('link', { name: '资料与素材', exact: true }).click();
  await expect(page).toHaveURL(/\?section=metadata$/);
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('Unsaved navigation draft');
  await page.getByRole('tab', { name: '封面与音频', exact: true }).click();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('封面与音频');
  await crumbs.getByRole('link', { name: '节目详情', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/productions\/production-test$/);
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('Unsaved navigation draft');
});
