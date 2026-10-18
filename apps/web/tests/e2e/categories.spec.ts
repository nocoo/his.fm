import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Category } from '../../src/shared/category';
import { e2eOrigin } from './origin';

test('category metadata preserves icon/color selection, stale drafts and failures without writing legacy prompts', async ({
  page,
}) => {
  let category: Category = {
    id: 'custom',
    name: '研究笔记',
    icon: 'book-open',
    color: 'teal',
    prompt: '# 栏目\n先讲结论。',
    seo: {},
    version: 1,
    updatedAt: '2026-10-05T00:00:00Z',
    updatedBy: 'owner',
  };
  let fail = false;
  let missing = false;
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session'))
      return route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } });
    if (path.endsWith('/categories'))
      return route.fulfill({ json: { categories: missing ? [] : [category] } });
    if (path.endsWith('/categories/custom/prompt-slots'))
      return route.fulfill({ json: { version: 1, initialized: true, slots: [] } });
    if (path.endsWith('/categories/custom')) {
      if (route.request().method() === 'DELETE') {
        missing = true;
        return route.fulfill({ status: 204 });
      }
      if (route.request().method() === 'PUT') {
        const input = route.request().postDataJSON();
        expect(input).not.toHaveProperty('prompt');
        if (fail) {
          fail = false;
          return route.fulfill({ status: 503, json: { error: '保存失败，请重试' } });
        }
        if (input.version !== category.version)
          return route.fulfill({ status: 409, json: { error: '栏目已更新' } });
        category = { ...category, ...input, version: category.version + 1 };
      }
      return route.fulfill({ json: { category } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/categories/custom');
  await page.getByLabel('栏目名称', { exact: true }).fill('我的研究笔记');
  await page.getByRole('button', { name: '栏目图标: book-open', exact: true }).click();
  await page.getByRole('radio', { name: 'coffee', exact: true }).click();
  await page.getByRole('radio', { name: '琥珀', exact: true }).click();
  fail = true;
  await page.getByRole('button', { name: '保存栏目', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '栏目名称', exact: true })).toHaveValue('我的研究笔记');
  category = { ...category, name: '另一处修改', version: 3 };
  await page.getByRole('button', { name: '保存栏目', exact: true }).click();
  await expect(page.getByText('栏目已有新版本 · v3')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '栏目名称', exact: true })).toHaveValue('我的研究笔记');
  await page.getByRole('button', { name: '用我的草稿更新', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存 · v4');
  expect(category).toMatchObject({
    name: '我的研究笔记',
    icon: 'coffee',
    color: 'amber',
    prompt: '# 栏目\n先讲结论。',
  });
  await expect(page.getByRole('textbox', { name: '栏目提示词', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '前往提示词管理栏目槽位', exact: true }).click();
  await expect(page).toHaveURL(/scope=category(?::|%3A)custom/);
  await expect(page.getByText('还没有提示词槽位', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '管理栏目元数据', exact: true }).click();
  await page.getByRole('link', { name: '返回栏目管理', exact: true }).click();
  await expect(page.getByRole('link', { name: '编辑 我的研究笔记' })).toBeVisible();
  await page.getByRole('button', { name: '删除 我的研究笔记' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除栏目', exact: true }).click();
  await expect(page.getByText('还没有栏目', { exact: true })).toBeVisible();
});

test('new categories persist through the real local API and appear in episode selection without leaking prompts', async ({
  page,
}) => {
  let id = '';
  const categoryName = `栏目验收-${randomUUID().slice(0, 8)}`;
  await page.request.post('/admin/api/dev-login', { headers: { Origin: e2eOrigin() } });
  try {
    await page.goto('/admin/categories/new');
    await page.getByLabel('栏目名称', { exact: true }).fill(categoryName);
    await page.getByRole('button', { name: '保存栏目', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/categories\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    await page.getByRole('link', { name: '前往提示词管理栏目槽位', exact: true }).click();
    await expect(page.getByText('尚未迁移 · 旧版只读', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '只读迁移预演', exact: true }).click();
    await page.getByRole('button', { name: '应用已检查的迁移', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '确认应用提示词迁移', exact: true })
      .click();
    await page.getByRole('button', { name: '新增槽位', exact: true }).click();
    await page.getByRole('textbox', { name: '新槽位 ID', exact: true }).fill('acceptance');
    await page.getByRole('textbox', { name: '新槽位标题', exact: true }).fill('验收');
    await page.getByRole('button', { name: '加入草稿', exact: true }).click();
    await page
      .getByRole('textbox', { name: '槽位正文 · acceptance', exact: true })
      .fill('Private category acceptance marker.');
    await page.getByRole('button', { name: '保存全部提示词', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    await page.goto('/admin/productions/new');
    await page.getByRole('combobox', { name: '栏目', exact: true }).click();
    await page.getByRole('option', { name: categoryName, exact: true }).click();
    await expect(page.getByRole('combobox', { name: '栏目', exact: true })).toContainText(categoryName);
    const response = await page.request.get('/api/categories');
    expect(await response.text()).not.toContain('Private category acceptance marker');
    await page.goto(`/admin/channel?scope=category:${id}&slot=acceptance`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(page.getByRole('textbox', { name: '槽位正文 · acceptance', exact: true })).toContainText(
      'Private category acceptance marker.',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (id) {
      const { category } = await (await page.request.get(`/admin/api/categories/${id}`)).json();
      expect(
        (
          await page.request.delete(`/admin/api/categories/${id}?version=${category.version}`, {
            headers: { Origin: e2eOrigin() },
          })
        ).status(),
      ).toBe(204);
    }
  }
});
