import { mkdir } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import type { ChannelProfile } from '../../src/shared/channel';
import { defaultPrompts, channelDefault as initialContent } from '../../worker/prompt-defaults';

async function mockChannel(page: Page) {
  let channel: ChannelProfile = {
    version: 1,
    content: initialContent,
    prompts: { ...defaultPrompts },
    updatedAt: '2026-09-25T00:00:00Z',
    updatedBy: 'Owner',
  };
  let fail = false;
  const writes: unknown[] = [];
  await page.route('**/admin/api/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.route('**/admin/api/session', (route) =>
    route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } }),
  );
  await page.route('**/admin/api/channel', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { channel } });
    const body = request.postDataJSON();
    writes.push(body);
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { error: '测试保存失败，草稿保留' } });
    }
    if (body.version !== channel.version)
      return route.fulfill({ status: 409, json: { error: '全局提示词已在别处更新' } });
    channel = { ...channel, ...body, version: channel.version + 1 };
    return route.fulfill({ json: { channel } });
  });
  return {
    writes,
    saved: () => channel,
    fail: () => {
      fail = true;
    },
    conflict: () => {
      channel = {
        ...channel,
        version: channel.version + 1,
        content: '## 最新全局提示词\n\n另一个窗口补充的内容。',
      };
    },
  };
}

test('global prompt preserves Markdown, preview, undo, failed drafts and conflict choices', async ({
  page,
}) => {
  const state = await mockChannel(page);
  await page.goto('/admin/channel');
  const editor = page.getByRole('textbox', { name: '全局提示词正文', exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole('list', { name: '创作依据优先级' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存提示词', exact: true })).toBeDisabled();
  const content = '## 新的讲述\n\n保留真实的生活细节';
  await editor.fill(content);
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
    '## 真实细节\n\n**保留生活细节**  \n\n- 新增可追溯的资料要求\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst detail = 1;\n```\n\n[来源](https://example.com)\n\n<script>window.previewUnsafe = true</script>\n[无效](javascript:alert(1))';
  await editor.fill(markdown);
  await page.getByRole('radio', { name: '预览', exact: true }).click();
  const preview = page.getByRole('region', { name: '全局提示词正文预览', exact: true });
  await expect(preview.locator('h2')).toHaveText('真实细节');
  await expect(preview.locator('strong')).toHaveText('保留生活细节');
  await expect(preview.locator('table')).toBeVisible();
  await expect(preview.locator('pre')).toContainText('const detail = 1;');
  await expect(preview.locator('script, a[href^="javascript"]')).toHaveCount(0);
  await page.getByRole('radio', { name: '分栏', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  state.fail();
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试保存失败');
  await page.reload();
  await expect(page.getByText('已恢复此标签页中未保存的草稿。')).toBeVisible();
  await expect(editor).toContainText('新增可追溯的资料要求');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: '已保存 · v2' })).toBeVisible();
  expect(state.saved().content).toBe(markdown);
  expect(await page.evaluate(() => sessionStorage.getItem('hisfm-channel-draft:local'))).toBeNull();
  await editor.fill(`${markdown}\n\n当前窗口的独立修改`);
  state.conflict();
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(page.getByText('提示词已有新版本 · v3')).toBeVisible();
  await expect(editor).toContainText('当前窗口的独立修改');
  await page.getByText('对照最新版本', { exact: true }).click();
  await expect(page.getByText('另一个窗口补充的内容。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '用我的草稿更新', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(state.saved().version).toBe(3);
  await page.getByRole('button', { name: '采用最新版本', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '采用已保存的提示词', exact: true })
    .click();
  await expect(editor).toContainText('另一个窗口补充的内容。');
  await expect(editor).not.toContainText('当前窗口的独立修改');
  await expect(page.getByRole('status').filter({ hasText: '已保存 · v3' })).toBeVisible();
});

test('channel preserves drafts that are temporarily empty or too long to save', async ({ page }) => {
  const state = await mockChannel(page);
  await page.goto('/admin/channel');
  const editor = page.getByRole('textbox', { name: '全局提示词正文' });
  await expect(editor).toBeVisible();
  for (const content of ['', '尚待精简的草稿。'.repeat(4000)]) {
    await page.evaluate((content) => {
      sessionStorage.setItem('hisfm-channel-draft:local', JSON.stringify({ content, version: 1 }));
    }, content);
    await page.reload();
    await expect(editor).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(sessionStorage.getItem('hisfm-channel-draft:local') ?? '{}').content),
      )
      .toBe(content);
    await expect(page.locator('#global-prompt-status')).toContainText(content.length.toLocaleString());
    await expect(page.getByRole('button', { name: '保存提示词', exact: true })).toBeDisabled();
    await expect(page.getByText('已恢复此标签页中未保存的草稿。')).toBeVisible();
  }
  expect(state.writes).toHaveLength(0);
});

test('channel editor supports a real local save, Chinese input, mobile layout and both themes', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '进入本地工作室' }).click();
  await page.waitForURL('**/admin');
  await page.goto('/admin/channel');
  const original = await page.evaluate(
    async () => ((await (await fetch('/admin/api/channel')).json()) as { channel: ChannelProfile }).channel,
  );
  try {
    const editor = page.getByRole('textbox', { name: '全局提示词正文' });
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('\n\n中文输入验收：愿每个具体的人被认真看见。');
    await page.getByRole('button', { name: '保存提示词', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `已保存 · v${original.version + 1}` }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('radio', { name: '预览', exact: true }).click();
    await expect(page.getByRole('region', { name: '全局提示词正文预览' })).toContainText('中文输入验收');
    await page.getByRole('radio', { name: '编辑', exact: true }).click();
    await mkdir('.local', { recursive: true });
    await page.screenshot({ path: '.local/channel-desktop.png' });
    await page.setViewportSize({ width: 393, height: 852 });
    await page.reload();
    await expect(editor).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await editor.evaluate((el) => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
    const compact = await page.evaluate(() => ({
      header: document.querySelector('.admin-page > header')?.getBoundingClientRect().height,
      toolbar: document.querySelector('.markdown-toolbar')?.getBoundingClientRect().height,
      shellScroll: document.querySelector('.admin-shell')?.scrollTop,
    }));
    expect(compact.header).toBeLessThanOrEqual(40);
    expect(compact.toolbar).toBeLessThanOrEqual(100);
    expect(compact.shellScroll).toBe(0);
    await page.screenshot({ path: '.local/channel-phone.png' });
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: '.local/channel-phone-dark.png' });
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '工作室导航' }).getByText('提示词', { exact: true }),
    ).toBeVisible();
  } finally {
    const result = await page.evaluate(
      async ({ content, version }) => {
        const { channel } = (await (await fetch('/admin/api/channel')).json()) as { channel: ChannelProfile };
        if (channel.version === version && channel.content === content) return 200;
        if (
          channel.version !== version + 1 ||
          !channel.content.includes('中文输入验收：愿每个具体的人被认真看见。')
        )
          return 409;
        const response = await fetch('/admin/api/channel', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: channel.version, content }),
        });
        return response.status;
      },
      { content: original.content, version: original.version },
    );
    expect(result).toBe(200);
  }
});

test('stage prompts keep independent drafts and undo, merge unrelated saves and persist Chinese edits', async ({
  page,
}) => {
  const state = await mockChannel(page);
  await page.goto('/admin/channel?prompt=coordinator');
  const choose = async (name: string) => {
    await page.getByRole('combobox', { name: '提示词环节' }).click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  const coordinator = page.getByRole('textbox', { name: '工作流协调', exact: true });
  await expect(coordinator).toContainText(defaultPrompts.coordinator);
  await coordinator.fill('主控中文草稿');
  await choose('上下文压缩');
  const compact = page.getByRole('textbox', { name: '上下文压缩', exact: true });
  await expect
    .poll(() =>
      compact
        .locator('.cm-line')
        .allTextContents()
        .then((lines) => lines.join('\n')),
    )
    .toBe(defaultPrompts.compaction);
  await compact.fill('压缩中文草稿');
  await choose('工作流协调');
  await expect(coordinator).toContainText('主控中文草稿');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(coordinator).toContainText(defaultPrompts.coordinator);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect.poll(() => state.saved().prompts.coordinator).toBe('主控中文草稿');
  await choose('上下文压缩');
  await expect(compact).toContainText('压缩中文草稿');
  await compact.focus();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => state.saved().prompts.compaction).toBe('压缩中文草稿');
  expect(state.saved().prompts.coordinator).toBe('主控中文草稿');
  expect(state.saved().content).toBe(initialContent);
  expect(state.writes).toHaveLength(2);
  await page.reload();
  await expect(compact).toContainText('压缩中文草稿');
  await choose('会话复用决策');
  await page.getByRole('textbox', { name: '会话复用决策', exact: true }).fill('中'.repeat(1501));
  await expect(page.getByRole('button', { name: '保存提示词', exact: true })).toBeDisabled();
});

test('prompt controls stay compact and readable across viewport sizes and themes', async ({ page }) => {
  await mockChannel(page);
  const categoryName = '长期研究与开发者日常生活中的经验和证据'.repeat(4);
  await page.route('**/admin/api/categories', (route) =>
    route.fulfill({ json: { categories: [{ id: 'long', name: categoryName, icon: 'mic', color: 'blue' }] } }),
  );
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('hisfm-theme', value), theme);
    for (const width of [320, 393, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/admin/channel?prompt=coordinator');
      await expect(page.getByRole('textbox', { name: '工作流协调', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', theme);
      const trigger = page.getByRole('combobox', { name: '提示词环节' });
      const save = page.getByRole('button', { name: '保存提示词', exact: true });
      await expect(save).toHaveCount(1);
      await expect(page.locator('.channel-page header')).toHaveCount(1);
      const bounds = await page.locator('.channel-page').evaluate((element) => {
        const header = element.querySelector('header')?.getBoundingClientRect();
        const editor = element.querySelector('.markdown-editor')?.getBoundingClientRect();
        return {
          height: header?.height ?? 0,
          gap: (editor?.top ?? 0) - (header?.bottom ?? 0),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(bounds.height).toBeLessThanOrEqual(width === 320 ? 80 : 40);
      expect(bounds.gap).toBeLessThan(width === 320 ? 88 : 64);
      expect(bounds.overflow).toBe(false);
      await trigger.click();
      const menu = page.getByRole('listbox');
      await expect(menu).toBeVisible();
      await expect(page.getByRole('group', { name: '外部工作流程', exact: true })).toBeVisible();
      const normal = page.getByRole('option', { name: '上下文压缩', exact: true });
      expect(await normal.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(40);
      const long = page.getByRole('option', { name: `栏目 · ${categoryName}`, exact: true });
      await long.scrollIntoViewIfNeeded();
      const geometry = await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          overflow: element.scrollWidth > element.clientWidth,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(8);
      expect(geometry.right).toBeLessThanOrEqual(width - 8);
      expect(geometry.width).toBeGreaterThan(160);
      expect(geometry.overflow).toBe(false);
      await page.screenshot({ path: `.local/prompts-menu-${theme}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(menu).toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/admin/channel?prompt=coordinator');
  await expect(page.getByRole('textbox', { name: '工作流协调', exact: true })).toBeVisible();
  const trigger = page.getByRole('combobox', { name: '提示词环节' });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: '工作流协调', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: '通用执行', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('通用执行');
  await expect(page.getByRole('textbox', { name: '通用执行', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存提示词', exact: true })).toHaveCount(1);
});

test('narration is an ordinary versioned prompt with Markdown undo and no generation settings', async ({
  page,
}) => {
  const state = await mockChannel(page);
  await page.goto('/admin/channel?prompt=narration');
  const editor = page.getByRole('textbox', { name: '旁白风格', exact: true });
  await expect(editor).toContainText(defaultPrompts.narration);
  await editor.fill('## 旁白\n\n自然、平静地讲述真实细节。');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).toContainText(defaultPrompts.narration);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect.poll(() => state.saved().prompts.narration).toBe('## 旁白\n\n自然、平静地讲述真实细节。');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    version: 1,
    prompts: { narration: '## 旁白\n\n自然、平静地讲述真实细节。' },
  });
  await expect(page.getByRole('button', { name: /生成/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /声音|提供商/ })).toHaveCount(0);
  await page.screenshot({ path: '.local/admin-narration-prompt.png', fullPage: true });
});
