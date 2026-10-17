import { mkdir } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import type { Episode } from '../../src/shared/episode';

const platforms = [
  ['x', 'X / Twitter'],
  ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'],
  ['wechat', '微信聊天'],
  ['slack', 'Slack'],
  ['discord', 'Discord'],
  ['imessage', 'iMessage'],
  ['telegram', 'Telegram'],
] as const;
const episodeId = 'local-episode-01';
let writes: string[];
let errors: string[];

test.beforeEach(async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:27056');
  writes = [];
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/login');
  await page.getByRole('button', { name: '进入本地工作室', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
});

test.afterEach(() => {
  expect(writes, 'Preview interactions must not write content or settings').toEqual([]);
  expect(errors).toEqual([]);
});

async function publishedMetadata(page: Page, path: string) {
  const publicPage = await page.context().newPage();
  try {
    await publicPage.goto(path);
    return {
      title: await publicPage.locator('meta[property="og:title"]').getAttribute('content'),
      description: await publicPage.locator('meta[property="og:description"]').getAttribute('content'),
      url: await publicPage.locator('meta[property="og:url"]').getAttribute('content'),
      image: await publicPage.locator('meta[property="og:image"]').getAttribute('content'),
    };
  } finally {
    await publicPage.close();
  }
}

async function assertMetadata(preview: Locator, expected: Awaited<ReturnType<typeof publishedMetadata>>) {
  await expect(preview.locator('.social-card-title')).toHaveText(expected.title ?? '');
  await expect(preview.locator('.social-card-description')).toHaveText(expected.description ?? '');
  await preview.getByText('查看实际解析的 SEO 元数据', { exact: true }).click();
  const values = preview.locator('dl dd');
  await expect(values.nth(0)).toHaveText(expected.title ?? '');
  await expect(values.nth(1)).toHaveText(expected.description ?? '');
  await expect(values.nth(2)).toHaveText(expected.url ?? '');
  await expect(values.nth(3)).toHaveText(expected.image ?? '');
  await expect(values.nth(5)).toHaveText('summary_large_image');
}

async function selectPlatform(page: Page, preview: Locator, id: string, label: string) {
  await preview.getByRole('combobox', { name: '社交预览平台' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(preview.locator(`.social-card-${id}`)).toBeVisible();
}

async function savedEpisode(page: Page) {
  const response = await page.request.get(`/admin/api/episodes/${episodeId}`);
  expect(response.ok()).toBe(true);
  const { episode } = (await response.json()) as { episode: Episode };
  expect(episode.status).toBe('published');
  expect(episode.sourceProductionId).toBeNull();
  return episode;
}

function sharingImageRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/episodes/') && url.pathname.endsWith('/share.jpg')) {
      requests.push(url.pathname);
    }
  });
  return requests;
}

test('saved standalone preview matches public metadata across eight platforms without saving edits', async ({
  page,
}) => {
  const episode = await savedEpisode(page);
  const expected = await publishedMetadata(page, `/episodes/${episode.category}/${episode.slug}`);
  const imageRequests = sharingImageRequests(page);
  await page.goto(`/admin/episodes/${episode.id}`);
  const preview = page.locator('.social-preview');
  await assertMetadata(preview, expected);
  await expect(preview.locator('.social-card img')).toHaveAttribute('src', expected.image ?? '');
  await expect
    .poll(() => preview.locator('.social-card img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1200);
  for (const [id, label] of platforms) {
    await selectPlatform(page, preview, id, label);
    await expect(preview.locator('.social-card-title')).toHaveText(expected.title ?? '');
    await expect(preview.locator('.social-card img')).toHaveAttribute('src', expected.image ?? '');
    if (id === 'wechat') {
      const image = await preview.locator('.social-card-image').boundingBox();
      expect(image).not.toBeNull();
      expect(Math.abs((image?.width ?? 0) - (image?.height ?? 0))).toBeLessThan(1);
    }
  }
  expect(imageRequests).toEqual([`/episodes/${episode.id}/share.jpg`]);
  await expect(page.locator('.admin-footnote')).toHaveText('所有改动已保存。');
  await selectPlatform(page, preview, 'x', 'X / Twitter');
  await mkdir('.local', { recursive: true });
  await preview.screenshot({ path: '.local/admin-social-preview-desktop.png', animations: 'disabled' });

  await page.getByLabel('节目标题', { exact: true }).fill('浏览器验收：未保存的节目标题');
  await expect(preview.locator('.social-card-title')).toContainText('浏览器验收：未保存的节目标题');
  await page.locator('#episode-seo-title').fill('浏览器验收：未保存的 SEO 标题');
  await page.locator('#episode-seo-description').fill('这段分享描述只在编辑器中预览，不会保存。');
  await expect(preview.locator('.social-card-title')).toHaveText('浏览器验收：未保存的 SEO 标题');
  await expect(preview.locator('.social-card-description')).toHaveText(
    '这段分享描述只在编辑器中预览，不会保存。',
  );
  const newImage = '/media/social-preview-unsaved-only.jpg';
  const changedImageRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === newImage) changedImageRequests.push(request.url());
  });
  await page.locator('#episode-seo-og-image').fill(newImage);
  await expect(preview.locator('.social-card img')).toHaveCount(0);
  await expect(preview.getByText('图片待公开或保存后可用', { exact: true })).toBeVisible();
  expect(changedImageRequests).toEqual([]);
  const persisted = await savedEpisode(page);
  expect(persisted).toEqual(episode);
  await page.reload();
  await expect(preview.locator('.social-card-title')).toHaveText(expected.title ?? '');
  await expect(page.locator('.admin-footnote')).toHaveText('所有改动已保存。');
});

test('new episode drafts do not request or imply an available public share image', async ({ page }) => {
  const imageRequests = sharingImageRequests(page);
  await page.goto('/admin/episodes/new');
  const preview = page.locator('.social-preview');
  await expect(preview.locator('.social-card')).toBeVisible();
  await page.getByLabel('节目标题', { exact: true }).fill('尚未保存的本地草稿');
  await page.getByLabel('链接名称', { exact: true }).fill('unsaved-preview-draft');
  await expect(preview.locator('.social-card-title')).toContainText('尚未保存的本地草稿');
  for (const [id, label] of platforms) {
    await selectPlatform(page, preview, id, label);
    await expect(preview.locator('.social-card img')).toHaveCount(0);
  }
  await preview.getByText('查看实际解析的 SEO 元数据', { exact: true }).click();
  await expect(preview.getByText('保存节目后生成分享图地址', { exact: true })).toBeVisible();
  expect(imageRequests).toEqual([]);
});

test('homepage SEO preview matches the public homepage and updates unsaved text live', async ({ page }) => {
  const expected = await publishedMetadata(page, '/');
  await page.goto('/admin/seo');
  const preview = page.locator('.social-preview');
  await assertMetadata(preview, expected);
  await expect(preview.locator('img')).toHaveAttribute('src', expected.image ?? '');
  await page.locator('#default-title').fill('首页：仅用于预览的未保存标题');
  await expect(preview.locator('.social-card-title')).toHaveText('首页：仅用于预览的未保存标题');
  await selectPlatform(page, preview, 'facebook', 'Facebook');
  await expect(preview.locator('.social-card-title')).toHaveText('首页：仅用于预览的未保存标题');
  await page.reload();
  await expect(preview.locator('.social-card-title')).toHaveText(expected.title ?? '');
});

test('example production publication panel honestly previews a saved draft without share image requests', async ({
  page,
}) => {
  const imageRequests = sharingImageRequests(page);
  await page.goto('/admin/productions/example-how-to-live-better?section=publication');
  await expect(page.getByRole('tab', { name: '发布', exact: true })).toHaveAttribute('aria-selected', 'true');
  const preview = page.locator('.social-preview');
  await expect(preview.getByText(/制作草稿推演/)).toBeVisible();
  await expect(preview.locator('.social-card-title')).toContainText('下班后，还要追多少个 AI？');
  await expect(preview.locator('.social-card img')).toHaveCount(0);
  await selectPlatform(page, preview, 'wechat', '微信聊天');
  await preview.getByText('查看实际解析的 SEO 元数据', { exact: true }).click();
  await expect(preview.locator('dl dd').nth(3)).toContainText(
    '/episodes/example-how-to-live-better/share.jpg',
  );
  expect(imageRequests).toEqual([]);
  await mkdir('.local', { recursive: true });
  await preview.screenshot({ path: '.local/admin-social-preview-production.png', animations: 'disabled' });
});

test.describe('390px social previews', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('all platform cards stay within the phone viewport', async ({ page }) => {
    await page.goto(`/admin/episodes/${episodeId}`);
    const preview = page.locator('.social-preview');
    await expect(preview.locator('.social-card')).toBeVisible();
    for (const [id, label] of platforms) {
      await selectPlatform(page, preview, id, label);
      const bounds = await preview.locator('.social-card').boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await selectPlatform(page, preview, 'x', 'X / Twitter');
    await mkdir('.local', { recursive: true });
    await preview.screenshot({ path: '.local/admin-social-preview-mobile390.png', animations: 'disabled' });
  });
});
