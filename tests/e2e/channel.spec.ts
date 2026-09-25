import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import type { ChannelProfile } from '../../src/shared/channel';

const initialContent = readFileSync(
  new URL('../../worker/channel-default.md', import.meta.url),
  'utf8',
).trim();
async function mockChannel(page: Page) {
  let channel: ChannelProfile = {
    version: 1,
    content: initialContent,
    updatedAt: '2026-09-25T00:00:00Z',
    updatedBy: 'Owner',
  };
  let fail = false;
  const writes: unknown[] = [];
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
      return route.fulfill({ status: 409, json: { error: '频道定位已在别处更新' } });
    channel = { ...channel, content: body.content, version: channel.version + 1 };
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
        content: '## 最新频道定位\n\n另一个窗口补充的内容。',
      };
    },
  };
}

test('channel document editing keeps formatting, undo history, failed drafts and conflict choices', async ({
  page,
}) => {
  const state = await mockChannel(page);
  await page.goto('/admin/channel');
  const editor = page.getByRole('textbox', { name: '频道定位正文' });
  await expect(editor).toContainText('有温度，有柔情，不谄媚');
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByRole('list', { name: '创作依据优先级' }).locator('strong')).toHaveText([
    '频道定位',
    '本期中心思想',
    '素材资料',
  ]);
  await expect(page.getByRole('button', { name: '保存定位', exact: true })).toBeDisabled();
  await editor.locator('p').last().click();
  await expect(page.getByRole('button', { name: '正文', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByRole('button', { name: '正文', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '正文', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(editor.locator('p').last()).toBeEmpty();
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await page.keyboard.insertText('保留真实的生活细节');
  await expect(editor.locator('strong').last()).toHaveText('保留真实的生活细节');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).not.toContainText('保留真实的生活细节');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(editor).toContainText('保留真实的生活细节');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '项目列表', exact: true }).click();
  await page.keyboard.insertText('新增可追溯的资料要求');
  await expect(editor.locator('li').last()).toHaveText('新增可追溯的资料要求');
  state.fail();
  await page.getByRole('button', { name: '保存定位', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试保存失败');
  await expect(editor).toContainText('新增可追溯的资料要求');
  await page.reload();
  await expect(page.getByText('已恢复此标签页中未保存的草稿。')).toBeVisible();
  await expect(editor).toContainText('保留真实的生活细节');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: '已保存 · v2' })).toBeVisible();
  expect(state.saved().content).toContain('**保留真实的生活细节**');
  expect(state.saved().content).toContain('新增可追溯的资料要求');
  expect(await page.evaluate(() => sessionStorage.getItem('hisfm-channel-draft:local'))).toBeNull();
  await editor.locator('p').last().click();
  await expect(page.getByRole('button', { name: '正文', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('当前窗口的独立修改');
  state.conflict();
  await page.getByRole('button', { name: '保存定位', exact: true }).click();
  await expect(page.getByText('定位已有新版本 · v3')).toBeVisible();
  await expect(editor).toContainText('当前窗口的独立修改');
  await page.getByText('对照最新版本', { exact: true }).click();
  await expect(page.getByText('另一个窗口补充的内容。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '用我的草稿更新', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(state.saved().version).toBe(3);
  await page.getByRole('button', { name: '采用最新版本', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '采用已保存的定位', exact: true }).click();
  await expect(editor).toContainText('另一个窗口补充的内容。');
  await expect(editor).not.toContainText('当前窗口的独立修改');
  await expect(page.getByRole('status').filter({ hasText: '已保存 · v3' })).toBeVisible();
});

test('channel preserves drafts that are temporarily empty or too long to save', async ({ page }) => {
  const state = await mockChannel(page);
  await page.goto('/admin/channel');
  const editor = page.getByRole('textbox', { name: '频道定位正文' });
  await expect(editor).toBeVisible();
  for (const content of ['', '尚待精简的草稿。'.repeat(4000)]) {
    await page.evaluate((content) => {
      sessionStorage.setItem('hisfm-channel-draft:local', JSON.stringify({ content, version: 1 }));
    }, content);
    await page.reload();
    await expect(editor).toHaveText(content);
    await expect(page.getByRole('button', { name: '保存定位', exact: true })).toBeDisabled();
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
    const editor = page.getByRole('textbox', { name: '频道定位正文' });
    await expect(editor).toBeVisible();
    await editor.locator('p').last().click();
    await expect(page.getByRole('button', { name: '正文', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('中文输入验收：愿每个具体的人被认真看见。');
    await page.getByRole('button', { name: '保存定位', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `已保存 · v${original.version + 1}` }),
    ).toBeVisible();
    await page.reload();
    await expect(editor).toContainText('中文输入验收');
    await mkdir('.local', { recursive: true });
    await page.screenshot({ path: '.local/channel-desktop.png' });
    await page.setViewportSize({ width: 393, height: 852 });
    await page.reload();
    await expect(editor).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await editor.evaluate((el) => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
    await page.screenshot({ path: '.local/channel-phone.png' });
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: '.local/channel-phone-dark.png' });
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '工作室导航' }).getByText('频道定位', { exact: true }),
    ).toBeVisible();
  } finally {
    const result = await page.evaluate(async (content) => {
      const { channel } = (await (await fetch('/admin/api/channel')).json()) as { channel: ChannelProfile };
      const response = await fetch('/admin/api/channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: channel.version, content }),
      });
      return response.status;
    }, original.content);
    expect(result).toBe(200);
  }
});
