import { mkdir } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import type { StorageObject } from '../../src/shared/storage';

const row = (key: string, changes: Partial<StorageObject> = {}): StorageObject => ({
  key,
  version: `v-${key}`,
  size: 1024 * 1024,
  uploaded: '2026-01-01T00:00:00Z',
  contentType: 'audio/wav',
  kind: 'audio',
  state: 'unused',
  reasons: ['未检测到站内引用'],
  ...changes,
});
const wav = Buffer.alloc(16044);
wav.write('RIFF');
wav.writeUInt32LE(16036, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(16000, 40);

async function mockStorage(page: Page, initial: StorageObject[]) {
  let objects = [...initial];
  let failScan = false;
  let failCleanup = false;
  const writes: { key: string; version: string }[][] = [];
  await page.route('**/admin/api/session', (route) =>
    route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } }),
  );
  await page.route('**/admin/api/storage**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/object')) return route.fulfill({ contentType: 'audio/wav', body: wav });
    if (url.pathname.endsWith('/cleanup')) {
      const { items } = route.request().postDataJSON();
      writes.push(items);
      if (failCleanup) {
        failCleanup = false;
        return route.fulfill({ status: 503, json: { error: '测试清理中断' } });
      }
      const results = items.map((item: { key: string }) => {
        const object = objects.find((object) => object.key === item.key);
        if (item.key === 'changed.wav')
          return { key: item.key, status: 'skipped', bytes: 0, reason: '已被新节目引用' };
        objects = objects.filter((object) => object.key !== item.key);
        return { key: item.key, status: 'deleted', bytes: object?.size ?? 0, reason: '已删除' };
      });
      return route.fulfill({ json: { results } });
    }
    if (failScan && url.searchParams.has('cursor'))
      return route.fulfill({ status: 503, json: { error: '测试分页失败' } });
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    return route.fulfill({
      json: {
        objects: objects.slice(cursor, cursor + 20),
        cursor: objects.length > cursor + 20 ? String(cursor + 20) : null,
      },
    });
  });
  return {
    writes,
    failScan: () => {
      failScan = true;
    },
    recover: () => {
      failScan = false;
    },
    failCleanup: () => {
      failCleanup = true;
    },
  };
}

test('storage scans pages, previews audio and confirms selective cleanup with fresh reference checks', async ({
  page,
}) => {
  const state = await mockStorage(page, [
    row('protected.wav', { state: 'referenced', reasons: ['节目：晚饭'] }),
    row('changed.wav'),
    ...Array.from({ length: 31 }, (_, i) => row(`old-${i}.wav`)),
  ]);
  await page.goto('/admin/storage');
  await expect(page.getByRole('status').filter({ hasText: '扫描完成' })).toBeVisible();
  await expect(page.getByText('筛选后 33 个 · 第 1 / 2 页')).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '选择 protected.wav', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '搜索资源' }).fill('changed.wav');
  await page.getByRole('button', { name: '预览 changed.wav', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '资源预览' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration))
    .toBe(1);
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '搜索资源' }).clear();
  await page.getByRole('button', { name: '选择筛选结果中可清理的文件', exact: true }).click();
  await page.getByRole('button', { name: '清理 32 个 · 32.0 MiB', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('本地 R2 删除 32 个文件');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await page.getByRole('button', { name: '清理 32 个 · 32.0 MiB', exact: true }).click();
  await page.getByRole('button', { name: '永久删除选中资源', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '本次清理' })).toContainText(
    '已删除 31 个，释放 31.0 MiB；跳过或失败 1 个',
  );
  expect(state.writes.map((items) => items.length)).toEqual([25, 7]);
  expect(state.writes.flat().some((item) => item.key === 'protected.wav')).toBe(false);
  await page.getByText('查看未删除的文件', { exact: true }).click();
  await expect(page.getByText('changed.wav：已被新节目引用', { exact: true })).toBeVisible();
});

test('incomplete scans cannot clean, retry recovers and cleanup failures remain visible', async ({
  page,
}) => {
  const state = await mockStorage(
    page,
    Array.from({ length: 22 }, (_, i) => row(`old-${i}.wav`)),
  );
  state.failScan();
  await page.goto('/admin/storage');
  await expect(page.getByRole('alert')).toContainText('测试分页失败');
  await expect(page.getByRole('button', { name: '选择筛选结果中可清理的文件', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  state.recover();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '扫描完成' })).toBeVisible();
  await page.getByRole('checkbox', { name: '选择 old-0.wav', exact: true }).click();
  state.failCleanup();
  await page.getByRole('button', { name: '清理 1 个 · 1.0 MiB', exact: true }).click();
  await page.getByRole('button', { name: '永久删除选中资源', exact: true }).click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试清理中断');
  await expect(page.getByRole('button', { name: '清理 1 个 · 1.0 MiB', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '扫描完成' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '选择 old-0.wav', exact: true })).not.toBeChecked();
});

test('resource management fits mobile in both themes and can read the real local bucket', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '进入本地工作室', exact: true }).click();
  await page.waitForURL('**/admin');
  await page.goto('/admin/storage');
  await expect(page.getByRole('status').filter({ hasText: '扫描完成' })).toBeVisible();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/storage-desktop.png' });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '扫描完成' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/storage-phone.png' });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: '.local/storage-phone-dark.png' });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '工作室导航' }).getByText('资源管理', { exact: true }),
  ).toBeVisible();
});
