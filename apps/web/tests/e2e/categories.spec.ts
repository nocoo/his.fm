import { expect, test } from '@playwright/test';
import type { Category } from '../../src/shared/category';

test('category editor preserves Markdown, icon/color selection, stale drafts and server failures', async ({
  page,
}) => {
  let category: Category = {
    id: 'custom',
    name: '研究笔记',
    icon: 'book-open',
    color: 'teal',
    prompt: '# 栏目\n先讲结论。',
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
    if (path.endsWith('/categories/custom')) {
      if (route.request().method() === 'DELETE') {
        missing = true;
        return route.fulfill({ status: 204 });
      }
      if (route.request().method() === 'PUT') {
        const input = route.request().postDataJSON();
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
  await page.getByRole('button', { name: '保存栏目', exact: true }).click();
  await page.getByRole('link', { name: '前往提示词编辑栏目风格' }).click();
  const editor = page.getByRole('textbox', { name: '栏目提示词', exact: true });
  await editor.fill('# 新风格\n每段先给一个结论。');
  await page.getByRole('radio', { name: '预览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新风格', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '编辑', exact: true }).click();
  await expect(editor).toContainText('每段先给一个结论');
  fail = true;
  await page.getByRole('button', { name: '保存栏目', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败');
  await page.reload();
  await expect(page.getByText('栏目风格 · 我的研究笔记', { exact: true })).toBeVisible();
  await expect(editor).toContainText('每段先给一个结论');
  category = { ...category, name: '另一处修改', version: 3 };
  await page.getByRole('button', { name: '保存栏目', exact: true }).click();
  await expect(page.getByText('栏目已有新版本 · v3')).toBeVisible();
  await expect(editor).toContainText('每段先给一个结论');
  await page.getByRole('button', { name: '用我的草稿更新', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存 · v4');
  expect(category).toMatchObject({
    name: '另一处修改',
    icon: 'coffee',
    color: 'amber',
    prompt: '# 新风格\n每段先给一个结论。',
  });
  await page.getByRole('link', { name: '返回栏目管理', exact: true }).click();
  await expect(page.getByRole('link', { name: '编辑 另一处修改' })).toBeVisible();
  await page.getByRole('button', { name: '删除 另一处修改' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除栏目', exact: true }).click();
  await expect(page.getByText('还没有栏目', { exact: true })).toBeVisible();
});

test('new categories persist through the real local API and appear in episode selection without leaking prompts', async ({
  page,
}) => {
  let id = '';
  await page.request.post('/admin/api/dev-login', { headers: { Origin: 'https://hisfm.dev.hexly.ai' } });
  try {
    await page.goto('/admin/categories/new');
    await page.getByLabel('栏目名称', { exact: true }).fill('栏目验收');
    await page.getByRole('button', { name: '保存栏目', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/categories\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    await page.getByRole('link', { name: '前往提示词编辑栏目风格' }).click();
    await page
      .getByRole('textbox', { name: '栏目提示词', exact: true })
      .fill('Private category acceptance marker.');
    await page.getByRole('button', { name: '保存栏目', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    await page.goto('/admin/productions/new');
    await page.getByRole('combobox', { name: '栏目', exact: true }).click();
    await page.getByRole('option', { name: '栏目验收', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '栏目', exact: true })).toContainText('栏目验收');
    const response = await page.request.get('/api/categories');
    expect(await response.text()).not.toContain('Private category acceptance marker');
    await page.goto(`/admin/channel?prompt=category:${id}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(page.getByRole('textbox', { name: '栏目提示词', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (id) {
      const { category } = await (await page.request.get(`/admin/api/categories/${id}`)).json();
      expect(
        (
          await page.request.delete(`/admin/api/categories/${id}?version=${category.version}`, {
            headers: { Origin: 'https://hisfm.dev.hexly.ai' },
          })
        ).status(),
      ).toBe(204);
    }
  }
});
