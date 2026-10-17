import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { scopePresets, scopes, wavHeader } from '@his-fm/contracts';
import { expect, type Page, test } from '@playwright/test';
import type { Episode } from '../../src/shared/episode';
import type { AgentTokenRecord, BumperRecord, ProductionAction } from '../../src/shared/production';
import { applyAction, applyPatch } from '../../worker/production-model';
import { fixture, human, readyFixture } from '../worker/production-fixture';
import { e2eOrigin } from './origin';

async function studio(page: Page, initial = fixture()) {
  let production = initial;
  let episodes: Episode[] = [];
  let conflict = false;
  let failUpload = false;
  let failSave = false;
  let bumpers: BumperRecord[] = [];
  let tokens: AgentTokenRecord[] = [];
  let failTokenDelete = false;
  let failTokenLoad = false;
  let failLibrary = false;
  const actions: ProductionAction[] = [];
  const uploads: { path: string; type: string; bytes: number }[] = [];
  const requests: string[] = [];
  await page.route('https://f.no.mt/audio.wav', (route) =>
    route.fulfill({
      contentType: 'audio/wav',
      body: Buffer.concat([Buffer.from(wavHeader(48000)), Buffer.alloc(48000)]),
    }),
  );
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice('/admin/api'.length);
    const method = request.method();
    requests.push(`${method} ${path}`);
    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: status === 204 ? '' : JSON.stringify(body),
      });
    if (path === '/session') return send({ mode: 'local', user: { email: 'editor@his.fm' } });
    if (path === '/categories')
      return send({
        categories: [
          { id: 'manager-notes', name: '主理人手札', icon: 'briefcase-business', color: 'blue' },
          { id: 'life', name: '生活留白', icon: 'leaf', color: 'amber' },
        ],
      });
    if (path === '/bumpers') {
      if (method === 'GET') return send({ bumpers });
      if (failUpload) {
        failUpload = false;
        return send({ error: '上传失败，请重试' }, 503);
      }
      const bumper: BumperRecord = {
        id: 'bumper-one',
        name: url.searchParams.get('name') ?? '',
        position: 'intro',
        version: 1,
        key: 'intro',
        url: '/media/intro.wav',
        durationSeconds: 2,
        size: 96044,
      };
      bumpers = [bumper];
      return send({ bumper }, 201);
    }
    if (path === '/agent-tokens') {
      if (method === 'GET') {
        if (failTokenLoad) {
          failTokenLoad = false;
          return send({ error: '令牌列表加载失败' }, 503);
        }
        return send({ tokens });
      }
      const input = request.postDataJSON();
      const record: AgentTokenRecord = {
        id: randomUUID(),
        name: input.name,
        prefix: 'hisfm_once',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + input.expiresInDays * 86400000).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
        scopes: input.scopes,
      };
      tokens = [record, ...tokens];
      return send({ record, token: 'hisfm_one_time_plaintext_for_test' }, 201);
    }
    if (path.startsWith('/agent-tokens/')) {
      const id = decodeURIComponent(path.split('/')[2]);
      if (path.endsWith('/revoke') && method === 'POST')
        tokens = tokens.map((record) =>
          record.id === id ? { ...record, revokedAt: new Date().toISOString() } : record,
        );
      else if (method === 'DELETE') {
        if (failTokenDelete) {
          failTokenDelete = false;
          return send({ error: '删除失败，请重试' }, 503);
        }
        if (!tokens.find((record) => record.id === id)?.revokedAt)
          return send({ error: '请先撤销令牌' }, 409);
        tokens = tokens.filter((record) => record.id !== id);
      } else return send({ error: '不支持这个请求方式' }, 405);
      return send(null, 204);
    }
    if (path === '/episodes') return send({ episodes });
    if (path === '/productions') {
      if (method === 'POST') {
        production = fixture({ ...request.postDataJSON(), id: 'new-production' });
        return send({ production }, 201);
      }
      if (failLibrary) {
        failLibrary = false;
        return send({ error: '节目库加载失败' }, 503);
      }
      return send({ productions: [production] });
    }
    if (!path.startsWith('/productions/')) return send({ error: 'Unexpected retired API' }, 404);
    if (method === 'GET') return send({ production });
    if (path.includes('/assets/')) {
      expect(url.searchParams.get('version')).toBe(String(production.version));
      if (failUpload) {
        failUpload = false;
        return send({ error: '上传失败，请重试' }, 503);
      }
      const asset = path.endsWith('/audio') ? 'audio' : 'cover';
      if (method === 'PUT')
        uploads.push({
          path,
          type: request.headers()['content-type'],
          bytes: request.postDataBuffer()?.length ?? 0,
        });
      production = {
        ...production,
        version: production.version + 1,
        stage: production.stage === 'ready' ? 'production' : production.stage,
        approvals: { ...production.approvals, final: null },
        assets: { ...production.assets, [asset]: method === 'DELETE' ? null : readyFixture().assets[asset] },
      };
      return send({ production });
    }
    if (method === 'DELETE') {
      expect(url.searchParams.get('version')).toBe(String(production.version));
      return send(null, 204);
    }
    const input = request.postDataJSON();
    if (failSave) {
      failSave = false;
      return send({ error: '保存失败，请重试' }, 503);
    }
    if (conflict) {
      conflict = false;
      production = { ...production, version: production.version + 1 };
      return send({ error: '内容已更新，请刷新后重试' }, 409);
    }
    expect(input.version).toBe(production.version);
    if (path.endsWith('/actions')) {
      actions.push(input);
      const action = input as ProductionAction;
      production = {
        ...applyAction(
          action.changes ? applyPatch(production, action.changes, human) : production,
          action,
          human,
        ),
        version: production.version + 1,
      };
    } else if (path.endsWith('/publications'))
      production = {
        ...production,
        version: production.version + 1,
        publications: [
          ...production.publications,
          {
            ...input,
            url: input.platform === 'site' ? '' : input.url,
            confirmedAt: new Date().toISOString(),
            confirmedBy: 'editor@his.fm',
          },
        ],
      };
    else {
      const { version: _, ...fields } = input;
      production = { ...applyPatch(production, fields, human), version: production.version + 1 };
    }
    return send({ production });
  });
  return {
    get production() {
      return production;
    },
    actions,
    uploads,
    requests,
    conflict: () => {
      conflict = true;
    },
    failSave: () => {
      failSave = true;
    },
    failUpload: () => {
      failUpload = true;
    },
    setTokens: (records: AgentTokenRecord[]) => {
      tokens = records;
    },
    failTokenDelete: () => {
      failTokenDelete = true;
    },
    failTokenLoad: () => {
      failTokenLoad = true;
    },
    setEpisodes: (records: Episode[]) => {
      episodes = records;
    },
    failLibrary: () => {
      failLibrary = true;
    },
  };
}

function snapshot(sourceProductionId: string | null): Episode {
  const production = readyFixture();
  return {
    id: sourceProductionId ? 'linked' : 'standalone',
    version: 1,
    title: production.title,
    slug: production.slug,
    episodeNumber: 8,
    category: 'life',
    tags: [],
    summary: '已发布节目',
    transcript: production.transcript,
    showNotes: production.description,
    coverUrl: '/media/cover.png',
    audioUrl: '/media/audio.wav',
    durationSeconds: 600,
    featured: false,
    status: 'published',
    publishedAt: production.updatedAt,
    sourceProductionId,
    createdAt: production.createdAt,
    updatedAt: production.updatedAt,
  };
}

test('library defaults to covers, deduplicates explicit snapshots and preserves grid/list filters', async ({
  page,
}) => {
  const state = await studio(page, readyFixture());
  state.setEpisodes([snapshot('production-test'), snapshot(null)]);
  await page.goto('/admin');
  const grid = page.getByRole('region', { name: '节目封面网格' });
  await expect(grid.locator('.library-card')).toHaveCount(2);
  await expect(page.getByRole('radio', { name: '封面网格', exact: true })).toBeChecked();
  await expect(page.getByRole('complementary', { name: '主控对话' })).toHaveCount(0);
  await page.getByRole('radio', { name: '列表', exact: true }).click();
  const table = page.getByRole('table', { name: '节目库列表' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.locator('.library-thumbnail')).toHaveCount(2);
  await page.getByRole('combobox', { name: '节目状态' }).click();
  await page.getByRole('option', { name: '草稿', exact: true }).click();
  await expect(page.getByText('没有符合条件的节目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await page.getByRole('radio', { name: '封面网格', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索节目', exact: true }).fill('不匹配');
  await expect(page.getByText('没有符合条件的节目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  state.failLibrary();
  await page.getByRole('button', { name: '刷新节目库', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('节目库加载失败');
  await expect(grid.locator('.library-card')).toHaveCount(2);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByText('节目库加载失败', { exact: true })).toHaveCount(0);
  expect(state.requests.some((request) => /agent\/|ai-settings|production-settings/.test(request))).toBe(
    false,
  );
});

test('detail sections keep drafts and Markdown undo while saves and approvals remain explicit', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test');
  await expect(page.getByRole('tablist', { name: '节目详情分区' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(4);
  await page.getByLabel('节目标题', { exact: true }).fill('尚未保存的节目标题');
  await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
  const manuscript = page.getByRole('textbox', { name: '完整逐字稿', exact: true });
  await manuscript.fill('# 逐字稿草稿\n\n保留这个具体的细节。');
  await page.getByRole('tab', { name: '封面与音频', exact: true }).click();
  await page.getByLabel('节目摘要', { exact: true }).fill('尚未保存的摘要');
  await page.getByRole('tab', { name: /资料与素材/ }).click();
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('尚未保存的节目标题');
  expect(state.actions).toHaveLength(0);
  state.failSave();
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('保存失败');
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect.poll(() => state.production.title).toBe('尚未保存的节目标题');
  await page.getByRole('button', { name: '标记选题完成', exact: true }).click();
  await expect.poll(() => state.production.approvals.brief).not.toBeNull();
  await page.getByRole('tab', { name: /逐字稿/ }).click();
  await expect(manuscript).toContainText('保留这个具体的细节');
  await page.locator('.studio-section:visible').getByRole('button', { name: '撤销', exact: true }).click();
  await expect(manuscript).not.toContainText('保留这个具体的细节');
  await page.locator('.studio-section:visible').getByRole('button', { name: '重做', exact: true }).click();
  state.conflict();
  await page.getByRole('button', { name: '保存逐字稿', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('内容已更新');
  await expect(manuscript).toContainText('保留这个具体的细节');
  await page.getByRole('button', { name: '刷新内容', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('未保存输入会被替换');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(manuscript).toContainText('保留这个具体的细节');
  await page.getByRole('tab', { name: /封面与音频/ }).click();
  await expect(page.getByLabel('节目摘要', { exact: true })).toHaveValue('尚未保存的摘要');
});

test('manual cover and WAV uploads retain failures and detach only after explicit confirmation', async ({
  page,
}) => {
  const state = await studio(
    page,
    readyFixture({
      stage: 'production',
      assets: { cover: null, audio: null },
      approvals: { ...readyFixture().approvals, final: null },
    }),
  );
  await page.goto('/admin/productions/production-test?section=assets');
  const section = page.locator('.studio-section:visible');
  const cover = section.getByLabel('上传节目封面', { exact: true });
  await cover.setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  state.failUpload();
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('上传失败');
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await expect(section.locator('.studio-cover .framed-cover-image')).toHaveAttribute(
    'src',
    'https://f.no.mt/cover.png',
  );
  await expect(section.locator('.studio-cover .framed-cover-overlay')).toHaveAttribute(
    'src',
    /\/brand\/frames\/.+\.svg$/,
  );
  const wav = Buffer.concat([Buffer.from(wavHeader(48000)), Buffer.alloc(48000)]);
  await section.getByLabel('上传节目音频', { exact: true }).setInputFiles({
    name: 'episode.wav',
    mimeType: 'audio/wav',
    buffer: wav,
  });
  await page.getByRole('button', { name: '上传音频', exact: true }).click();
  await expect(section.locator('.his-audio-player')).toBeVisible();
  expect(state.uploads).toContainEqual({
    path: '/productions/production-test/assets/audio',
    type: 'audio/wav',
    bytes: wav.length,
  });
  await page.getByRole('button', { name: '解除音频关联', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(state.production.assets.audio).not.toBeNull();
  await page.getByRole('button', { name: '解除音频关联', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '解除音频关联', exact: true }).click();
  await expect(section.locator('.his-audio-player')).toHaveCount(0);
  expect(state.production.assets.audio).toBeNull();
  expect(state.requests.some((request) => /\/audio$/.test(request) && request.startsWith('POST'))).toBe(
    false,
  );
});

test('publication keeps current asset, final approval and explicit record gates', async ({ page }) => {
  const state = await studio(
    page,
    readyFixture({ stage: 'production', approvals: { ...readyFixture().approvals, final: null } }),
  );
  await page.goto('/admin/productions/production-test?section=publication');
  await expect(page.getByRole('button', { name: '记录已发布', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '批准成品', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '提交最终检查', exact: true }).click();
  await expect.poll(() => state.production.stage).toBe('final_review');
  await page.getByRole('button', { name: '批准成品', exact: true }).click();
  await expect.poll(() => state.production.stage).toBe('ready');
  await expect(page.getByRole('button', { name: '记录已发布', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: '记录发布平台' }).click();
  await page.getByRole('option', { name: '微信公众号', exact: true }).click();
  await page.getByLabel('已发布的节目链接', { exact: true }).fill('https://mp.weixin.qq.com/s/verified');
  await page.getByLabel('实际发布时间', { exact: true }).fill('2026-09-25T12:30');
  await page.getByRole('button', { name: '记录已发布', exact: true }).click();
  expect(state.production.publications).toHaveLength(0);
  await page.getByRole('alertdialog').getByRole('button', { name: '确认记录此次发布', exact: true }).click();
  await expect.poll(() => state.production.publications.length).toBe(1);
});

test('site publication requires confirmation but sends no external URL', async ({ page }) => {
  const state = await studio(page, readyFixture());
  await page.goto('/admin/productions/production-test?section=publication');
  await expect(page.getByRole('combobox', { name: '记录发布平台' })).toContainText('his.fm 本站');
  await expect(page.getByLabel('已发布的节目链接', { exact: true })).toHaveCount(0);
  await page.getByLabel('实际发布时间', { exact: true }).fill('2026-09-25T12:30');
  await page.getByRole('button', { name: '记录已发布', exact: true }).click();
  expect(state.production.publications).toHaveLength(0);
  const request = page.waitForRequest(
    (value) => value.method() === 'POST' && value.url().endsWith('/publications'),
  );
  await page.getByRole('alertdialog').getByRole('button', { name: '确认记录此次发布', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({
    version: 1,
    platform: 'site',
    publishedAt: new Date('2026-09-25T12:30').toISOString(),
  });
  await expect.poll(() => state.production.publications.length).toBe(1);
  await expect(page.getByRole('link', { name: 'his.fm 本站', exact: true })).toHaveAttribute(
    'href',
    `/episodes/${state.production.slug}`,
  );
});

test('cover grid and detail sections fit desktop and phone in both themes without native UI', async ({
  page,
}) => {
  const state = await studio(page, readyFixture());
  state.setEpisodes([snapshot('production-test'), snapshot(null)]);
  const cover = await readFile('public/images/episode-01.webp');
  await page.route('**/cover.png', (route) => route.fulfill({ contentType: 'image/webp', body: cover }));
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('hisfm-theme', value), theme);
    for (const width of [1440, 393]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin');
      await expect(page.getByRole('region', { name: '节目封面网格' })).toBeVisible();
      const loaded = (selector: string) =>
        page.locator(selector).evaluateAll((images) =>
          images.every((image) => {
            const img = image as HTMLImageElement;
            return img.complete && img.naturalWidth > 0;
          }),
        );
      await expect(page.locator('.library-cover .framed-cover-image')).toHaveCount(2);
      await expect.poll(() => loaded('.library-cover .framed-cover-image')).toBe(true);
      if (width === 1440) {
        const tops = await page
          .locator('.library-filters > input, .library-filters > button')
          .evaluateAll((controls) =>
            controls.map((control) => Math.round(control.getBoundingClientRect().top)),
          );
        expect(new Set(tops).size).toBe(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.local/admin-library-grid-${theme}-${width}.png`, fullPage: true });
      const list = page.getByRole('radio', { name: '列表', exact: true });
      await list.click();
      await expect(list).toBeChecked();
      await expect
        .poll(() =>
          page
            .getByRole('radiogroup', { name: '节目显示方式' })
            .locator('[data-slot="selection-indicator"]')
            .evaluate((indicator) => {
              const { left, width } = indicator.getBoundingClientRect();
              return { left: Math.round(left), width: Math.round(width) };
            }),
        )
        .toEqual(
          await list.evaluate((control) => {
            const { left, width } = control.getBoundingClientRect();
            return { left: Math.round(left), width: Math.round(width) };
          }),
        );
      await expect(page.getByRole('table', { name: '节目库列表' })).toBeVisible();
      await expect(page.locator('.library-thumbnail .framed-cover-image')).toHaveCount(2);
      await expect.poll(() => loaded('.library-thumbnail .framed-cover-image')).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.local/admin-library-list-${theme}-${width}.png`, fullPage: true });
      await page.goto('/admin/productions/production-test?section=assets');
      await expect(page.locator('.studio-section:visible .his-audio-player')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.admin-shell').evaluate((element) => element.scrollTop)).toBe(0);
      await expect(page.getByRole('button', { name: /生成/ })).toHaveCount(0);
      await page.screenshot({ path: `.local/admin-detail-assets-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('tab', { name: /逐字稿/ }).click();
      await expect(page.getByRole('region', { name: '完整逐字稿预览', exact: true })).toBeVisible();
      await page.screenshot({ path: `.local/admin-detail-manuscript-${theme}-${width}.png`, fullPage: true });
    }
  }
});

test('only a finished download receives branding and the original is never rewritten', async ({ page }) => {
  const production = readyFixture();
  const before = structuredClone(production);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/admin/api/')) writes.push(request.url());
  });
  const original = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#c86432';
    context.fillRect(0, 0, 600, 300);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('https://f.no.mt/cover.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(original, 'base64'),
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  );
  const state = await studio(page, production);
  await page.goto(`/admin/productions/${production.id}?section=assets`);
  await expect(page.locator('.studio-section:visible .studio-cover .framed-cover-image')).toHaveAttribute(
    'src',
    production.assets.cover?.url ?? '',
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /下载含品牌框架的封面成品/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `his-fm-ep-${String(production.episodeNumber).padStart(3, '0')}.png`,
  );
  const path = await download.path();
  if (!path) throw new Error('Downloaded file missing');
  const pixels = await page.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0);
      const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      return {
        width: image.width,
        height: image.height,
        rail: sample(30, 800),
        subject: sample(800, 800),
        margin: sample(800, 220),
      };
    },
    Array.from(await readFile(path)),
  );
  expect(pixels).toEqual({
    width: 1600,
    height: 1600,
    rail: [214, 242, 91, 255],
    subject: [200, 100, 50, 255],
    margin: [245, 244, 238, 255],
  });
  await expect(page.getByText('成品已生成，原图保持不变。', { exact: true })).toBeVisible();
  expect(state.production).toEqual(before);
  expect(writes).toEqual([]);
  await page.route('**/brand/frames/*.svg', (route) => route.fulfill({ status: 503, body: '' }));
  await page.reload();
  await page.getByRole('button', { name: /下载含品牌框架的封面成品/ }).click();
  await expect(page.getByText('封面或品牌框架未能加载，请稍后重试。', { exact: true })).toBeVisible();
  expect(state.production).toEqual(before);
});

test('separate bumper and connection pages preserve failed uploads and transient tokens', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/bumpers');
  await page.getByLabel('贴片名称').fill('Opening');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'intro.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(96) });
  state.failUpload();
  await page.getByRole('button', { name: '加入贴片库', exact: true }).click();
  await expect(page.getByText('上传失败，请重试', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '加入贴片库', exact: true }).click();
  await expect(page.locator('audio[src="/media/intro.wav"]')).toHaveCount(1);
  await page.goto('/admin/connections');
  const origin = new URL(page.url()).origin;
  await expect(page.getByRole('link', { name: '接入说明', exact: true })).toHaveAttribute(
    'href',
    `${origin}/api/agent/instructions`,
  );
  await expect(page.getByLabel('令牌名称')).toHaveCount(0);
  await page.getByRole('button', { name: '创建令牌', exact: true }).click();
  await page.getByLabel('令牌名称').fill('Hermes');
  await page.getByLabel('有效天数').fill('7');
  await expect(page.getByRole('combobox', { name: '权限预设' })).toContainText('只读（默认）');
  const creation = page.waitForRequest(
    (request) => request.url().endsWith('/agent-tokens') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: '创建访问令牌', exact: true }).click();
  expect((await creation).postDataJSON()).toEqual({
    name: 'Hermes',
    expiresInDays: 7,
    scopes: scopePresets.reader,
  });
  await expect(page.getByLabel('新建访问令牌')).toHaveValue('hisfm_one_time_plaintext_for_test');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('hisfm_one_time');
  await page.reload();
  await expect(page.getByLabel('新建访问令牌')).toHaveCount(0);
  await page
    .getByRole('button', { name: `Hermes：已授权 ${scopePresets.reader.length} 项权限`, exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Hermes的权限' })).toContainText('productions:read');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '撤销 Hermes' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认撤销令牌' }).click();
  await expect(page.getByRole('button', { name: '撤销 Hermes' })).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除 Hermes' })).toBeVisible();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/studio-settings.png', fullPage: true });
});

test('token grants require explicit high-risk consent and reset it after grant changes', async ({ page }) => {
  await studio(page);
  await page.goto('/admin/connections');
  await page.getByRole('button', { name: '创建令牌', exact: true }).click();
  await page.getByLabel('令牌名称').fill('Scoped agent');
  const create = page.getByRole('button', { name: '创建访问令牌', exact: true });
  await page.getByRole('combobox', { name: '权限预设' }).click();
  await page.getByRole('option', { name: '完全控制（高风险）', exact: true }).click();
  await expect(create).toBeDisabled();
  const risk = page.getByRole('region', { name: '高风险授权确认' });
  await expect(risk).toContainText('完全控制授权');
  await expect(risk).toContainText('令牌仅用于当前环境');
  const consent = page.getByRole('checkbox', { name: '我确认授予以上高风险权限' });
  await consent.check();
  await expect(create).toBeEnabled();
  await page.getByText(`逐项设置权限（已选 ${scopes.length} / ${scopes.length}）`).click();
  await page.getByRole('checkbox', { name: '删除制作', exact: true }).uncheck();
  await expect(page.getByRole('combobox', { name: '权限预设' })).toContainText('自定义权限');
  await expect(consent).not.toBeChecked();
  await expect(create).toBeDisabled();
  await consent.check();
  const creation = page.waitForRequest(
    (request) => request.url().endsWith('/agent-tokens') && request.method() === 'POST',
  );
  await create.click();
  expect((await creation).postDataJSON().scopes).toEqual(
    scopes.filter((scope) => scope !== 'productions:delete'),
  );
  await expect(page.getByLabel('新建访问令牌')).toBeVisible();
  await expect(create).toHaveCount(0);
  await page.getByRole('button', { name: '我已保存，关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建令牌', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '创建令牌', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '权限预设' })).toContainText('只读（默认）');
  await page.getByText(`逐项设置权限（已选 ${scopePresets.reader.length} / ${scopes.length}）`).click();
  for (const scope of scopePresets.reader) await page.locator(`[id="grant-${scope}"]`).uncheck();
  await expect(create).toBeDisabled();
  await expect(page.getByText(`逐项设置权限（已选 0 / ${scopes.length}）`)).toBeVisible();
});

test('token table separates statuses and confirms deletion with failure recovery', async ({ page }) => {
  const state = await studio(page);
  const record: AgentTokenRecord = {
    id: 'revoked-token',
    name: 'Old assistant',
    prefix: 'hisfm_old',
    scopes: ['episodes:read'],
    createdAt: '2026-01-01T10:00:00Z',
    expiresAt: '2099-01-01T10:00:00Z',
    lastUsedAt: null,
    revokedAt: '2026-01-02T10:00:00Z',
  };
  state.setTokens([
    record,
    { ...record, id: 'active-token', name: 'Current assistant', revokedAt: null },
    {
      ...record,
      id: 'expired-token',
      name: 'Expired assistant',
      revokedAt: null,
      expiresAt: '2000-01-01T10:00:00Z',
    },
  ]);
  await page.goto('/admin/connections');
  const table = page.getByRole('table', { name: '访问令牌列表' });
  await expect(table.getByRole('columnheader')).toHaveCount(5);
  await expect(table.getByRole('row').filter({ hasText: 'Current assistant' })).toContainText('有效');
  await expect(table.getByRole('row').filter({ hasText: 'Expired assistant' })).toContainText('已过期');
  await expect(table.getByRole('row').filter({ hasText: 'Old assistant' })).toContainText('已撤销');
  await expect(page.getByRole('button', { name: '删除 Current assistant' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除 Expired assistant' })).toHaveCount(0);
  await page.getByRole('button', { name: '删除 Old assistant' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(table).toContainText('Old assistant');
  state.failTokenDelete();
  await page.getByRole('button', { name: '删除 Old assistant' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('保留撤销记录和审计关联');
  await confirmation.getByRole('button', { name: '确认删除令牌' }).click();
  await expect(confirmation.getByRole('alert')).toContainText('删除失败，请重试');
  await confirmation.getByRole('button', { name: '确认删除令牌' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(table).not.toContainText('Old assistant');
  await page.reload();
  await expect(table).not.toContainText('Old assistant');
  await expect(table).toContainText('Current assistant');
  state.failTokenLoad();
  await page.getByRole('button', { name: '刷新令牌列表' }).click();
  await expect(page.getByText('令牌列表加载失败', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(table).toContainText('Current assistant');
});

test('token table and creation dialog stay usable on desktop and phone in both themes', async ({ page }) => {
  const state = await studio(page);
  state.setTokens([
    {
      id: 'layout-token',
      name: '只读资料助手',
      prefix: 'hisfm_layout',
      scopes: [...scopePresets.reader],
      createdAt: '2026-01-01T10:00:00Z',
      expiresAt: '2099-01-01T10:00:00Z',
      lastUsedAt: null,
      revokedAt: null,
    },
  ]);
  await mkdir('.local', { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 393]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/admin/connections');
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark');
      }, theme);
      const table = page.getByRole('table', { name: '访问令牌列表' });
      await expect(table).toContainText('只读资料助手');
      if (width === 1440) {
        const container = await page.locator('.studio-token-table').boundingBox();
        const action = await table.getByRole('button', { name: '撤销 只读资料助手' }).boundingBox();
        expect(container).not.toBeNull();
        expect(action).not.toBeNull();
        expect((action?.x ?? 0) + (action?.width ?? 0)).toBeLessThanOrEqual(
          (container?.x ?? 0) + (container?.width ?? 0),
        );
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.local/tokens-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: '创建令牌', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '创建访问令牌', exact: true });
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
      await page.getByText(`逐项设置权限（已选 ${scopePresets.reader.length} / ${scopes.length}）`).click();
      await expect(dialog.getByRole('region', { name: '令牌管理', exact: true })).toContainText(
        '删除已撤销令牌',
      );
      await page.screenshot({ path: `.local/token-create-${theme}-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: '创建令牌', exact: true })).toBeFocused();
    }
  }
});

test('source subpages preserve brief drafts and keep long materials out of the overview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const longText = `# 生活记录\n\n${'这一段写下具体的生活观察。\n\n'.repeat(70)}`;
  const state = await studio(
    page,
    fixture({
      sources: [
        { id: 'source-1', type: 'text', title: '生活记录', content: longText },
        {
          id: 'source-2',
          type: 'github',
          title: '项目原文',
          content: 'https://github.com/eternity4719/HowToLiveBetter',
        },
        { id: 'source-3', type: 'url', title: '参考文章', content: 'https://example.com/reference' },
      ],
    }),
  );
  await page.goto('/admin/productions/production-test?section=metadata');
  await expect(page.getByRole('complementary', { name: '主控对话' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const list = page.getByRole('list', { name: '原始素材', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  expect((await list.boundingBox())?.height).toBeLessThan(240);
  await expect(page.getByRole('textbox', { name: '素材正文', exact: true })).toHaveCount(0);
  await page.getByLabel('节目标题', { exact: true }).fill('保留选题的未保存标题');
  await page.getByLabel('创作意图', { exact: true }).fill('保留正在思考的切入点');
  await list.getByRole('button', { name: '打开素材 1：生活记录', exact: true }).click();
  await expect(page).toHaveURL(/source=source-1/);
  await expect(page.getByLabel('节目标题', { exact: true })).toBeHidden();
  await expect(page.getByRole('tablist', { name: '节目详情分区' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '资料与素材', exact: true })).toBeVisible();
  const content = page.getByRole('textbox', { name: '素材正文', exact: true });
  const expectDraft = async () => {
    const detail = page.locator('.studio-source-editor');
    await detail.getByRole('radio', { name: '预览', exact: true }).click();
    await expect(page.getByRole('region', { name: '素材正文预览' })).toContainText('保留下来的新观察。');
    await detail.getByRole('radio', { name: '编辑', exact: true }).click();
  };
  await expect(content).toBeVisible();
  const edited = `${longText}保留下来的新观察。`;
  await content.fill(edited);
  await page.goBack();
  await expect(list).toBeVisible();
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('保留选题的未保存标题');
  await expect(page.getByLabel('创作意图', { exact: true })).toHaveText('保留正在思考的切入点');
  await page.goForward();
  await expectDraft();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await list.getByRole('button', { name: '打开素材 2：项目原文', exact: true }).click();
  await expect(page.getByLabel('HTTPS 链接', { exact: true })).toHaveValue(
    'https://github.com/eternity4719/HowToLiveBetter',
  );
  await page.getByLabel('HTTPS 链接', { exact: true }).fill('http://example.com/invalid');
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('HTTPS');
  await page
    .getByLabel('HTTPS 链接', { exact: true })
    .fill('https://github.com/eternity4719/HowToLiveBetter');
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await list.getByRole('button', { name: '打开素材 3：参考文章', exact: true }).click();
  await page.getByRole('button', { name: '移除素材', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('素材标题', { exact: true })).toHaveValue('参考文章');
  await page.getByRole('button', { name: '移除素材', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '移除这份素材', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  expect(state.production.sources).toHaveLength(3);
  state.failSave();
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('保存失败');
  await list.getByRole('button', { name: '打开素材 1：生活记录', exact: true }).click();
  await expectDraft();
  await page.getByRole('button', { name: '返回资料与素材', exact: true }).click();
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect.poll(() => state.production.sources.length).toBe(2);
  expect(state.production.title).toBe('保留选题的未保存标题');
  expect(state.production.intent).toBe('保留正在思考的切入点');
  expect(state.production.sources[0].content).toBe(edited);
  await page.goto('/admin/productions/production-test?section=metadata&source=source-1');
  await expectDraft();
  expect(await page.locator('.admin-shell').evaluate((el) => el.scrollTop)).toBe(0);
  await page.goto('/admin/productions/production-test?section=metadata&source=missing-source');
  await expect(page.getByText('这份素材尚未保存或已被移除，请返回选题查看素材列表。')).toBeVisible();
  await page.getByRole('button', { name: '返回资料与素材', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
});

test('sidebar separates content, brand and settings with a highlighted website shortcut', async ({
  page,
}, testInfo) => {
  const state = await studio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  const sidebar = page.locator('[data-basalt-sidebar]');
  const website = sidebar.getByRole('link', { name: '访问网站', exact: true });
  const github = page.getByRole('link', { name: 'GitHub 仓库', exact: true });
  const groups = [
    ['内容制作', ['节目库', '新建节目', '栏目管理', '提示词', '贴片库']],
    ['品牌外观', ['品牌外观', '音色预览']],
    ['全站设置', ['连接管理', '资源管理']],
  ] as const;
  const expectGroups = async () => {
    await expect(sidebar.locator('.admin-nav-group')).toHaveCount(3);
    for (const [name, items] of groups) {
      const region = sidebar.getByRole('region', { name, exact: true });
      await expect(region.getByRole('button')).toHaveCount(items.length);
      for (const item of items)
        await expect(region.getByRole('button', { name: item, exact: true })).toBeVisible();
    }
    await expect(website).toBeInViewport();
    await expect(website).toHaveAttribute('href', '/');
    await expect(website).toHaveClass(/bg-basalt-primary/);
    await expect(website.locator('svg.lucide-globe')).toHaveCount(1);
    expect(
      await website.evaluate((link) => {
        const nav = document.querySelector('.admin-nav-group');
        return nav !== null && link.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top;
      }),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  };
  await expectGroups();
  await expect(website).toHaveText('访问网站');
  await expect(sidebar.getByRole('button', { name: '节目库', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sidebar.getByRole('link', { name: 'GitHub 仓库', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '访问网站', exact: true })).toHaveCount(1);
  const logo = sidebar.locator('.admin-rail-mark');
  const original = await logo.evaluate((element) => element.getBoundingClientRect().toJSON());
  const collapse = sidebar
    .locator('.admin-rail-header')
    .getByRole('button', { name: '收起导航', exact: true });
  const toggle = await collapse.evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(Math.abs(toggle.y + toggle.height / 2 - original.y - original.height / 2)).toBeLessThan(1);
  expect(toggle.x).toBeGreaterThan(original.right);
  await page.screenshot({ path: testInfo.outputPath('sidebar-desktop.png'), animations: 'disabled' });
  await collapse.click();
  await expect(sidebar).toHaveAttribute('data-collapsed', '');
  await expect(sidebar.getByRole('button', { name: '展开导航', exact: true })).toBeFocused();
  await expectGroups();
  await expect(website).toHaveText('');
  await expect.poll(() => logo.evaluate((element) => element.getBoundingClientRect().x)).toBe(original.x);
  await website.focus();
  await expect(page.getByRole('tooltip', { name: '访问网站', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(website).toBeFocused();
  await sidebar.getByRole('button', { name: '展开导航', exact: true }).click();
  await expect(sidebar).not.toHaveAttribute('data-collapsed');
  await expect(collapse).toBeFocused();
  await expect(website).toHaveText('访问网站');
  await expect.poll(() => logo.evaluate((element) => element.getBoundingClientRect().x)).toBe(original.x);
  for (const width of [1440, 393]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(github).toBeInViewport();
    await expect(github).toHaveAttribute('href', 'https://github.com/nocoo/his.fm');
    await expect(github).toHaveAttribute('target', '_blank');
    await expect(github).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(github).toHaveText('');
    await expect(github.locator('svg.lucide-github')).toHaveCount(1);
    await page.getByRole('button', { name: '切换主题', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(github).toBeFocused();
    await expect(page.getByRole('tooltip', { name: 'GitHub 仓库', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(github).toBeFocused();
  }
  const menu = page.getByRole('button', { name: '打开导航', exact: true });
  await expect(website).toBeHidden();
  await menu.click();
  await expectGroups();
  await expect(website).toHaveText('访问网站');
  await page.screenshot({ path: testInfo.outputPath('sidebar-phone-light.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await menu.click();
  await expectGroups();
  await page.screenshot({ path: testInfo.outputPath('sidebar-phone-dark.png'), animations: 'disabled' });
  await sidebar.getByRole('button', { name: '连接管理', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/connections$/);
  await expect(sidebar).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await expect(sidebar.getByRole('button', { name: '连接管理', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(state.requests.every((request) => request.startsWith('GET '))).toBe(true);
});

test('sidebar collapse remains reachable at the minimum resized width', async ({ page }) => {
  await studio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  const sidebar = page.locator('[data-basalt-sidebar]');
  const resize = sidebar.getByRole('separator', { name: 'Resize sidebar' });
  for (let step = 0; step < 10; step++) await resize.press('ArrowLeft');
  await expect(resize).toHaveAttribute('aria-valuenow', '180');
  const collapse = sidebar.getByRole('button', { name: '收起导航', exact: true });
  const railRight = await sidebar.evaluate((element) => element.getBoundingClientRect().right);
  expect(await collapse.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(
    railRight,
  );
  await collapse.click({ trial: true });
  await collapse.press('Enter');
  const expand = sidebar.getByRole('button', { name: '展开导航', exact: true });
  await expect(expand).toBeFocused();
  await expand.press('Space');
  await expect(collapse).toBeFocused();
  await expect(resize).toHaveAttribute('aria-valuenow', '180');
});

test('environment switch retains Basalt segment typography on desktop and phone', async ({ page }) => {
  await studio(page);
  await page.goto('/admin/productions/production-test');
  const environment = page.getByRole('radiogroup', { name: '工作室数据环境' });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ['Local', 'Prod']) {
      const segment = environment.getByRole('radio', { name, exact: true });
      await expect(segment).toBeInViewport();
      await expect(segment).toHaveCSS('font-size', '12px');
      await expect(segment).toHaveCSS('font-weight', '600');
      await expect(segment).toHaveCSS('letter-spacing', '0.3px');
      await expect(segment).toHaveCSS(
        'font-family',
        await page.locator('.admin-app').evaluate((element) => getComputedStyle(element).fontFamily),
      );
    }
  }
  await expect(environment.getByRole('radio', { name: 'Local', exact: true })).toBeChecked();
});

test('publication copies WeChat formatting with the same cover and references as its preview', async ({
  page,
  context,
}) => {
  const transcript =
    '## 一个具体的问题\n\n**生活细节**，参考[项目文档](https://example.com/docs)。\n\n> 留下自己的时间。';
  await studio(page, readyFixture({ transcript }));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin/productions/production-test?section=publication');
  await page.getByText('展开公众号正文预览', { exact: true }).click();
  const preview = page.locator('.studio-wechat-preview');
  await expect(preview.locator('img')).toHaveAttribute('src', 'https://f.no.mt/cover.png');
  await expect(preview.locator('strong')).toHaveText('生活细节');
  await expect(preview).toContainText('参考资料');
  await expect(preview).toContainText('[1] https://example.com/docs');
  await page.getByRole('button', { name: '复制微信公众号格式', exact: true }).click();
  await expect(page.getByText('已复制', { exact: true })).toBeVisible();
  const clipboard = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const [html, text] = await Promise.all([
      item.getType('text/html').then((blob) => blob.text()),
      item.getType('text/plain').then((blob) => blob.text()),
    ]);
    return { html, text };
  });
  expect(clipboard.html).toContain('<strong>生活细节</strong>');
  expect(clipboard.html).toContain('https://f.no.mt/cover.png');
  expect(clipboard.html).toContain('[1] https://example.com/docs');
  expect(clipboard.html).toMatch(/line-height:\s*1\.9/);
  expect(clipboard.text).toContain('生活细节');
  expect(clipboard.text).not.toContain('**');
  await page.getByRole('button', { name: '复制 Markdown', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(transcript);
});

test('retired token grants fail closed visibly and require explicit revoke before deletion', async ({
  page,
}) => {
  const state = await studio(page);
  state.setTokens([
    {
      id: 'legacy',
      name: 'Legacy token',
      prefix: 'hisfm_old',
      scopes: [],
      invalidScopes: ['runtime:connect', 'unknown:write'],
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2099-01-01T00:00:00Z',
      revokedAt: null,
      lastUsedAt: null,
    },
  ]);
  await page.goto('/admin/connections');
  const row = page
    .getByRole('table', { name: '访问令牌列表' })
    .getByRole('row')
    .filter({ hasText: 'Legacy token' });
  await expect(row).toContainText('权限已失效');
  await expect(row).not.toContainText('有效');
  await expect(row.getByRole('button', { name: '删除 Legacy token' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Legacy token：权限已失效，需要重新签发' }).click();
  const scopes = page.getByRole('dialog', { name: 'Legacy token的权限' });
  await expect(scopes).toContainText('无法通过认证');
  await expect(scopes).toContainText('runtime:connect');
  await expect(scopes).toContainText('unknown:write');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '撤销 Legacy token', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认撤销令牌', exact: true }).click();
  await expect(row).toContainText('已撤销');
  await expect(row.getByRole('button', { name: '删除 Legacy token' })).toBeVisible();
  await row.getByRole('button', { name: '删除 Legacy token' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除令牌', exact: true }).click();
  await expect(row).toHaveCount(0);
});

test('migrated tokens with no remaining grants are not marked active and can be revoked then deleted', async ({
  page,
}) => {
  const state = await studio(page);
  state.setTokens([
    {
      id: 'empty',
      name: 'Migrated token',
      prefix: 'hisfm_old',
      scopes: [],
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2099-01-01T00:00:00Z',
      revokedAt: null,
      lastUsedAt: null,
    },
  ]);
  await page.goto('/admin/connections');
  const row = page.getByRole('row').filter({ hasText: 'Migrated token' });
  await expect(row).toContainText('无授权');
  await expect(row).toContainText('需重新签发');
  await expect(row).not.toContainText('有效');
  await expect(row.getByRole('button', { name: '删除 Migrated token' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Migrated token：无授权，需要重新签发' }).click();
  await expect(page.getByRole('dialog', { name: 'Migrated token的权限' })).toContainText('无法通过认证');
  await page.screenshot({ path: '.local/admin-token-empty-grants.png', fullPage: true });
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: '撤销 Migrated token' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认撤销令牌', exact: true }).click();
  await expect(row).toContainText('已撤销');
  await row.getByRole('button', { name: '删除 Migrated token' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除令牌', exact: true }).click();
  await expect(row).toHaveCount(0);
});

test('environment switching confirms unsaved edits, recovers login errors and resets data on reload', async ({
  page,
}) => {
  await studio(page);
  let authorized = false;
  let failLogin = true;
  let connectCalls = 0;
  const remoteRequests: string[] = [];
  await page.route('**/admin/remote-api/**', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    expect(request.headers()['x-hisfm-remote']).toBe('1');
    const path = new URL(request.url()).pathname;
    remoteRequests.push(path);
    await route.fulfill({
      status: authorized ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(
        !authorized
          ? { error: '生产认证已失效' }
          : path.endsWith('/session')
            ? { mode: 'access', user: { email: 'editor@his.fm' } }
            : path.endsWith('/episodes')
              ? { episodes: [] }
              : path.endsWith('/categories')
                ? { categories: [] }
                : { productions: [fixture({ title: '生产环境参考节目' })] },
      ),
    });
  });
  await page.route('**/admin/remote-connect', async (route) => {
    connectCalls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-hisfm-remote']).toBe('1');
    authorized = !failLogin;
    await route.fulfill({
      status: failLogin ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify({ connected: !failLogin }),
    });
  });
  let nativeDialogs = 0;
  page.on('dialog', async (dialog) => {
    nativeDialogs++;
    await dialog.dismiss();
  });
  await page.goto('/admin/productions/production-test');
  await page.getByLabel('节目标题', { exact: true }).fill('尚未保存的本地选题');
  const production = page.getByRole('radio', { name: 'Prod', exact: true });
  await production.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('当前未保存的内容会丢弃');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('尚未保存的本地选题');
  expect(remoteRequests).toEqual([]);
  expect(connectCalls).toBe(0);
  await production.click();
  await dialog.getByRole('button', { name: '切换到生产环境', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('生产登录未完成，请重试');
  expect(await page.evaluate(() => localStorage.getItem('hisfm-admin-environment'))).toBeNull();
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('尚未保存的本地选题');
  failLogin = false;
  await dialog.getByRole('button', { name: '切换到生产环境', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('link', { name: '生产环境参考节目', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hisfm-admin-environment'))).toBe('production');
  expect(connectCalls).toBe(2);
  expect(nativeDialogs).toBe(0);
  await expect(page.getByRole('radio', { name: 'Prod', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/studio-production-environment.png', fullPage: true });
  authorized = false;
  await page.getByRole('button', { name: '刷新节目库' }).click();
  await expect(page.getByText('生产认证已失效', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Local', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Local', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: '下一条提示之前，先吃饭', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hisfm-admin-environment'))).toBe('local');
  expect(connectCalls).toBe(2);
  await expect(page.getByRole('radio', { name: 'Local', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  failLogin = true;
  await page.getByRole('radio', { name: 'Prod', exact: true }).click();
  await expect(page.getByText('生产登录未完成，请重试', { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hisfm-admin-environment'))).toBe('local');
  failLogin = false;
  await page.getByRole('radio', { name: 'Prod', exact: true }).click();
  await expect(page.getByRole('link', { name: '生产环境参考节目', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(connectCalls).toBe(4);
});

test('real local production saves, approves and reopens without navigation side effects', async ({
  page,
}) => {
  await page.request.post('/admin/api/dev-login', { headers: { Origin: e2eOrigin() } });
  const slug = `cms-e2e-${randomUUID()}`;
  let id = '';
  try {
    await page.goto('/admin/productions/new');
    await page.getByLabel('节目标题', { exact: true }).fill('真实接口节目管理验收');
    await page.getByLabel('链接名称', { exact: true }).fill(slug);
    await page.getByLabel('期数', { exact: true }).fill('99002');
    await page.getByLabel('创作意图', { exact: true }).fill('验证保存、审批和重开均为显式操作。');
    await page.getByRole('button', { name: '添加素材', exact: true }).click();
    await page.getByRole('combobox', { name: '素材 1 类型' }).click();
    await page.getByRole('option', { name: '文本素材', exact: true }).click();
    await page
      .getByRole('textbox', { name: '素材正文', exact: true })
      .fill('这是本地接口验收的临时测试素材。');
    await page.getByRole('button', { name: '完成编辑', exact: true }).click();
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/api/productions') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '保存选题', exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    id = (await created.json()).production.id;
    await expect(page).toHaveURL(new RegExp(`/admin/productions/${id}$`));
    await page.getByRole('tab', { name: '发布', exact: true }).click();
    await expect(page.getByRole('button', { name: '记录已发布', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: '资料与素材', exact: true }).click();
    await page.getByRole('button', { name: '标记选题完成', exact: true }).click();
    await expect(page.getByRole('tab', { name: '资料与素材', exact: true })).toHaveAttribute(
      'data-state',
      'active',
    );
    await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
    await page
      .getByRole('textbox', { name: '完整逐字稿', exact: true })
      .fill('你好，这是本地工作室真实接口验收的完整文稿。');
    await page.getByRole('button', { name: '标记逐字稿完成', exact: true }).click();
    await expect(page.getByRole('button', { name: '逐字稿已确认', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '重新打开逐字稿', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '重新打开已批准内容', exact: true })
      .click();
    await page.reload();
    await expect(page.locator('.studio-transcript:visible')).toContainText('真实接口验收的完整文稿');
    await expect(page.getByRole('button', { name: '标记逐字稿完成', exact: true })).toBeEnabled();
  } finally {
    if (id) {
      const status = await page.evaluate(async (id) => {
        const path = `/admin/api/productions/${id}`;
        const { production } = (await (await fetch(path)).json()) as { production: { version: number } };
        return (await fetch(`${path}?version=${production.version}`, { method: 'DELETE' })).status;
      }, id);
      expect(status).toBe(204);
    }
  }
});
