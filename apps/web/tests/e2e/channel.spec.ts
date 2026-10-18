import type { PromptSlotInput, PromptSlotTable } from '@his-fm/contracts';
import { expect, type Page, test } from '@playwright/test';
import { defaultPrompts } from '../../worker/prompt-defaults';

const initialSlots: PromptSlotInput[] = [
  {
    id: 'positioning',
    title: '定位',
    body: '## 讲述原则\n\n从真实的人和细节出发。',
    order: 0,
    enabled: true,
    mode: 'override',
  },
  {
    id: 'editor',
    title: '编辑',
    body: '先核实事实，再组织叙事。',
    order: 1,
    enabled: true,
    mode: 'override',
  },
  { id: 'skills', title: '技能名称', body: 'research\nwriting', order: 2, enabled: true, mode: 'override' },
];

function makeTable(): PromptSlotTable {
  return {
    version: 3,
    initialized: true,
    slots: initialSlots.map((slot) => ({
      ...slot,
      version: 11,
      updatedAt: '2026-10-18T00:00:00Z',
      updatedBy: 'owner',
    })),
  };
}

async function mockSlots(page: Page, categoryName = '研究笔记') {
  const tables = new Map([
    ['channel', makeTable()],
    ['category', makeTable()],
  ]);
  let fail = false;
  let staleMigration = false;
  const writes: { path: string; method: string; body: unknown }[] = [];
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/session'))
      return route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } });
    if (path.endsWith('/categories'))
      return route.fulfill({
        json: { categories: [{ id: 'research', name: categoryName, icon: 'mic', color: 'blue' }] },
      });
    if (path.endsWith('/channel'))
      return route.fulfill({
        json: { channel: { content: '旧版全局正文', prompts: defaultPrompts, version: 11 } },
      });
    if (path.endsWith('/categories/research'))
      return route.fulfill({ json: { category: { prompt: '旧版栏目正文' } } });
    if (!path.includes('/prompt-slots')) return route.fulfill({ json: {} });
    const scope = path.includes('/categories/') ? 'category' : 'channel';
    const table = tables.get(scope) as PromptSlotTable;
    if (path.endsWith('/migration/dry-run'))
      return route.fulfill({
        json: {
          version: table.version,
          legacyVersion: 11,
          initialized: table.initialized,
          slots: initialSlots,
          unmappedHeadings: ['未识别的附录'],
        },
      });
    if (request.method() === 'GET') return route.fulfill({ json: table });
    const body = request.postDataJSON();
    writes.push({ path, method: request.method(), body });
    if (path.endsWith('/migration/apply')) {
      if (staleMigration || body.version !== table.version || body.legacyVersion !== 11) {
        staleMigration = false;
        return route.fulfill({ status: 409, json: { error: '迁移预览过期' } });
      }
      tables.set(scope, { ...makeTable(), version: table.version + 1 });
      return route.fulfill({ json: tables.get(scope) });
    }
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { error: '测试保存失败，草稿保留' } });
    }
    if (body.version !== table.version)
      return route.fulfill({ status: 409, json: { error: '集合已在别处更新' } });
    const saved: PromptSlotTable = {
      ...table,
      version: table.version + 1,
      slots: body.slots.map((slot: PromptSlotInput) => ({
        ...slot,
        version: 12,
        updatedAt: 'now',
        updatedBy: 'owner',
      })),
    };
    tables.set(scope, saved);
    return route.fulfill({ json: saved });
  });
  return {
    writes,
    saved: (scope = 'channel') => tables.get(scope) as PromptSlotTable,
    fail: () => {
      fail = true;
    },
    conflict: () => {
      const table = tables.get('channel') as PromptSlotTable;
      tables.set('channel', {
        ...table,
        version: table.version + 1,
        slots: table.slots.map((slot) =>
          slot.id === 'positioning' ? { ...slot, body: '来自另一个窗口的最新原则。' } : slot,
        ),
      });
    },
    uninitialize: () => tables.set('channel', { version: 0, initialized: false, slots: [] }),
    staleMigration: () => {
      staleMigration = true;
    },
  };
}

async function choose(page: Page, label: string, name: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('slot Markdown retains formatting, safe preview, undo, failed drafts and collection conflicts', async ({
  page,
}) => {
  const state = await mockSlots(page);
  await page.goto('/admin/channel');
  const editor = page.getByRole('textbox', { name: '槽位正文 · positioning', exact: true });
  const save = page.getByRole('button', { name: '保存全部提示词', exact: true });
  await expect(editor).toContainText('从真实的人和细节出发');
  await expect(save).toBeDisabled();
  await editor.fill('## 新的讲述\n\n保留真实的生活细节');
  await page.getByRole('button', { name: '查找与替换', exact: true }).click();
  await page.getByRole('textbox', { name: '查找', exact: true }).fill('生活细节');
  await page.getByRole('button', { name: '下一个', exact: true }).click();
  await expect(editor.locator('.cm-searchMatch-selected')).toHaveText('生活细节');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(editor).toContainText('**');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).not.toContainText('**');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(editor).toContainText('**');
  const markdown =
    '## 真实细节\n\n**保留生活细节**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst detail = 1;\n```\n\n<script>window.previewUnsafe = true</script>\n[无效](javascript:alert(1))';
  await editor.fill(markdown);
  await page.getByRole('radio', { name: '预览', exact: true }).click();
  const preview = page.getByRole('region', { name: '槽位正文 · positioning预览', exact: true });
  await expect(preview.locator('h2')).toHaveText('真实细节');
  await expect(preview.locator('strong')).toHaveText('保留生活细节');
  await expect(preview.locator('table')).toBeVisible();
  await expect(preview.locator('pre')).toContainText('const detail = 1;');
  await expect(preview.locator('script, a[href^="javascript"]')).toHaveCount(0);
  await page.getByRole('radio', { name: '分栏', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  state.fail();
  await save.click();
  await expect(page.getByRole('alert')).toContainText('测试保存失败');
  await page.reload();
  await expect(page.getByText('已恢复此标签页中未保存的草稿。')).toBeVisible();
  await expect(editor).toContainText('保留生活细节');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: '已保存 · v4' })).toBeVisible();
  expect(state.saved().slots[0].body).toBe(markdown);
  expect(state.writes.at(-1)?.body).toMatchObject({ version: 3 });
  expect(
    await page.evaluate(() => sessionStorage.getItem('hisfm-prompt-slots-draft:local:channel')),
  ).toBeNull();
  await editor.fill(`${markdown}\n\n当前窗口的独立修改`);
  state.conflict();
  const writes = state.writes.length;
  await save.click();
  await expect(page.getByText('提示词槽位已有新版本 · v5')).toBeVisible();
  expect(state.writes).toHaveLength(writes);
  await expect(editor).toContainText('当前窗口的独立修改');
  await page.getByText('对照最新集合', { exact: true }).click();
  await expect(page.getByText('来自另一个窗口的最新原则。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '用我的全部草稿更新', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(state.saved().version).toBe(5);
  await page.getByRole('button', { name: '采用最新集合', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '采用已保存的槽位集合', exact: true })
    .click();
  await expect(editor).toContainText('来自另一个窗口的最新原则');
  await expect(editor).not.toContainText('当前窗口的独立修改');
});

test('collection drafts provide channel and category CRUD, enabled/mode controls and atomic reordering', async ({
  page,
}) => {
  const state = await mockSlots(page);
  for (const [scope, name] of [
    ['channel', '频道 · 全局'],
    ['category', '栏目 · 研究笔记'],
  ]) {
    await page.goto(`/admin/channel?scope=${scope === 'channel' ? 'channel' : 'category:research'}`);
    await expect(page.getByRole('combobox', { name: '提示词范围', exact: true })).toContainText(name);
    await page.getByRole('button', { name: '新增槽位', exact: true }).click();
    await page.getByRole('textbox', { name: '新槽位 ID', exact: true }).fill('custom-role');
    await page.getByRole('textbox', { name: '新槽位标题', exact: true }).fill('自定义角色');
    await page.getByRole('button', { name: '加入草稿', exact: true }).click();
    await page
      .getByRole('textbox', { name: '槽位正文 · custom-role', exact: true })
      .fill('## 自定义要求\n\n保留可追溯证据。');
    await page.getByRole('textbox', { name: '槽位标题', exact: true }).fill('证据整理');
    await page.getByRole('switch', { name: '启用槽位', exact: true }).click();
    await choose(page, '同名槽位策略', '追加到频道同 ID 槽位');
    await page.getByRole('button', { name: '上移槽位', exact: true }).click();
    expect(state.saved(scope).slots).toHaveLength(3);
    await page.getByRole('button', { name: '保存全部提示词', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存 · v4' })).toBeVisible();
    const custom = state.saved(scope).slots.find((slot) => slot.id === 'custom-role');
    expect(custom).toMatchObject({ title: '证据整理', enabled: false, mode: 'append', order: 2 });
    await page.getByRole('button', { name: '删除槽位', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '从草稿删除槽位', exact: true }).click();
    expect(state.saved(scope).slots).toHaveLength(4);
    await page.getByRole('button', { name: '保存全部提示词', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存 · v5' })).toBeVisible();
    expect(state.saved(scope).slots.map((slot) => slot.id)).toEqual(['positioning', 'editor', 'skills']);
  }
  expect(state.writes.map((write) => write.method)).toEqual(['PUT', 'PUT', 'PUT', 'PUT']);
  expect(state.writes.filter((write) => write.path.includes('/categories/research/'))).toHaveLength(2);
});

test('visited slot and scope editors preserve independent drafts and undo without saving on navigation', async ({
  page,
}) => {
  const state = await mockSlots(page);
  await page.goto('/admin/channel');
  const positioning = page.getByRole('textbox', { name: '槽位正文 · positioning', exact: true });
  await positioning.fill('频道定位草稿');
  await choose(page, '提示词槽位', '编辑');
  const editor = page.getByRole('textbox', { name: '槽位正文 · editor', exact: true });
  await editor.fill('编辑角色草稿');
  await choose(page, '提示词范围', '栏目 · 研究笔记');
  await positioning.fill('栏目定位草稿');
  await choose(page, '提示词范围', '频道 · 全局');
  await choose(page, '提示词槽位', '定位');
  await expect(positioning).toContainText('频道定位草稿');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(positioning).toContainText('从真实的人和细节出发');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await choose(page, '提示词槽位', '编辑');
  await expect(editor).toContainText('编辑角色草稿');
  expect(state.writes).toHaveLength(0);
  await page.getByRole('button', { name: '保存全部提示词', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已保存 · v4' })).toBeVisible();
  expect(
    state
      .saved()
      .slots.slice(0, 2)
      .map((slot) => slot.body),
  ).toEqual(['频道定位草稿', '编辑角色草稿']);
  expect(state.saved('category').slots[0].body).toBe(initialSlots[0].body);
  await choose(page, '提示词范围', '栏目 · 研究笔记');
  await expect(positioning).toContainText('栏目定位草稿');
  await positioning.focus();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: '已保存 · v4' })).toBeVisible();
  expect(state.saved('category').slots[0].body).toBe('栏目定位草稿');
  expect(state.writes).toHaveLength(2);
});

test('temporary invalid drafts survive reload and skills accepts only skill names', async ({ page }) => {
  const state = await mockSlots(page);
  await page.goto('/admin/channel?slot=skills');
  const editor = page.getByRole('textbox', { name: '槽位正文 · skills', exact: true });
  await editor.fill('请按这些指令执行');
  await expect(page.getByRole('button', { name: '保存全部提示词', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('skills 只能逐行填写技能名');
  await page.reload();
  await expect(editor).toContainText('请按这些指令执行');
  await editor.fill('research\nwriting');
  await page.getByRole('textbox', { name: '槽位标题', exact: true }).fill('');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '槽位标题', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '保存全部提示词', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

test('migration requires separate read-only preview, explicit confirmation and current versions; legacy stays read-only', async ({
  page,
}) => {
  const state = await mockSlots(page);
  state.uninitialize();
  await page.goto('/admin/channel');
  await expect(page.getByText('尚未迁移 · 旧版只读', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增槽位', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '应用已检查的迁移', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  await page.getByText('旧版整段提示词（只读）', { exact: true }).click();
  await page.getByRole('button', { name: '读取旧版只读内容', exact: true }).click();
  await page.getByText('旧版全局创作原则（只读）', { exact: true }).click();
  await expect(page.getByText('旧版全局正文', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: '只读迁移预演', exact: true }).click();
  await expect(page.getByRole('region', { name: '迁移预演结果', exact: true })).toContainText(
    '定位 · positioning',
  );
  await expect(page.getByRole('alert')).toContainText('未识别的附录');
  expect(state.writes).toHaveLength(0);
  await page.getByRole('button', { name: '应用已检查的迁移', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(state.writes).toHaveLength(0);
  state.staleMigration();
  await page.getByRole('button', { name: '应用已检查的迁移', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认应用提示词迁移', exact: true })
    .click();
  await expect(page.getByText('迁移预览已过期，未应用任何改动。请重新预演并检查最新内容。')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '应用已检查的迁移', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '只读迁移预演', exact: true }).click();
  await page.getByRole('button', { name: '应用已检查的迁移', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认应用提示词迁移', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: '槽位正文 · positioning', exact: true })).toBeVisible();
  expect(state.writes.at(-1)).toMatchObject({ method: 'POST', body: { version: 0, legacyVersion: 11 } });
  expect(state.writes.filter((write) => !write.path.includes('/migration/apply'))).toHaveLength(0);
});

test('slot controls remain compact, keyboard accessible and contained on mobile and both themes', async ({
  page,
}) => {
  const categoryName = '长期研究与开发者日常生活中的经验和证据'.repeat(4);
  await mockSlots(page, categoryName);
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('hisfm-theme', value), theme);
    for (const width of [320, 393, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/admin/channel');
      await expect(page.getByRole('textbox', { name: '槽位正文 · positioning', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', theme);
      await expect(page.getByRole('button', { name: '保存全部提示词', exact: true })).toHaveCount(1);
      await expect(page.locator('.channel-page header')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const headerHeight = await page
        .locator('.channel-page header')
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(headerHeight).toBeLessThanOrEqual(width === 320 ? 90 : 80);
      const trigger = page.getByRole('combobox', { name: '提示词范围', exact: true });
      await trigger.click();
      const option = page.getByRole('option', { name: `栏目 · ${categoryName}`, exact: true });
      await expect(option).toBeVisible();
      const geometry = await page.getByRole('listbox').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, overflow: element.scrollWidth > element.clientWidth };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(8);
      expect(geometry.right).toBeLessThanOrEqual(width - 8);
      expect(geometry.overflow).toBe(false);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      if (width === 320 || width === 1440)
        await page.screenshot({ path: `.local/prompt-slots-${theme}-${width}.png` });
    }
  }
  const trigger = page.getByRole('combobox', { name: '提示词槽位', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: '定位', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: '编辑', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: '槽位正文 · editor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /生成/ })).toHaveCount(0);
});
