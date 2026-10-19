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
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('节目库');
  await page.locator('[data-basalt-sidebar]').getByRole('button', { name: '品牌外观', exact: true }).click();
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

test('production paths and breadcrumb ancestors preserve drafts and fit phone headers', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/admin/productions/production-test?section=metadata');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
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
