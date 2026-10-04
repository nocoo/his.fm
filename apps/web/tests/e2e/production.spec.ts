import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { defaultSpeechSettings } from '@his-fm/contracts';
import { expect, type Page, test } from '@playwright/test';
import type { AgentTokenRecord, ProductionAction, ProductionSettings } from '../../src/shared/production';
import { applyAction, applyPatch } from '../../worker/production-model';
import { fixture, human, readyFixture } from '../worker/production-fixture';

async function studio(page: Page, initial = fixture()) {
  let production = initial;
  let conflict = false;
  let failUpload = false;
  let failPreview = false;
  let failSave = false;
  let audioPolls = 0;
  let settings: ProductionSettings = {
    voice: 'Kore',
    speakingStyle: '自然地讲述',
    provider: 'gemini',
    version: '0'.repeat(64),
    bumpers: [],
    providers: { gemini: false, elevenlabs: false },
    voices: { gemini: 'Kore', elevenlabs: 'kLhAstPcnnPxqzk6gS5i' },
    ttsConfigured: false,
  };
  let tokens: AgentTokenRecord[] = [];
  let ai = {
    version: '0'.repeat(64),
    settings: structuredClone(defaultSpeechSettings),
    providers: { gemini: false, elevenlabs: false, raven: true, decision: true },
    coordinator: { provider: 'raven', model: 'gpt-6-astra', thinkingLevel: 'high' },
    executor: { provider: 'raven', model: 'gpt-6.1-sol', thinkingLevels: ['low', 'medium', 'high'] },
    decision: { model: 'jev-latest', maxInputBytes: 16384, maxBatchQuestions: 12 },
  };
  const actions: ProductionAction[] = [];
  await page.route('**/admin/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice('/admin/api'.length);
    const method = request.method();
    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: status === 204 ? '' : JSON.stringify(body),
      });
    if (path === '/session') return send({ mode: 'local', user: { email: 'editor@his.fm' } });
    if (path === '/ai-settings') {
      if (method === 'PUT') {
        const input = request.postDataJSON();
        ai = {
          ...ai,
          version: String(Number.parseInt(ai.version, 16) + 1).padStart(64, '0'),
          settings: input.settings,
        };
        settings = {
          ...settings,
          provider: ai.settings.defaultProvider,
          voice: ai.settings[ai.settings.defaultProvider].voice,
          speakingStyle: ai.settings.speakingStyle,
          voices: { gemini: ai.settings.gemini.voice, elevenlabs: ai.settings.elevenlabs.voice },
        };
      }
      return send({ config: ai });
    }
    if (path === '/production-settings/previews') return send({ previews: [] });
    if (path === '/bumpers') {
      if (method === 'GET') return send({ bumpers: settings.bumpers });
      if (failUpload) {
        failUpload = false;
        return send({ error: '上传失败，请重试' }, 503);
      }
      const params = new URL(request.url()).searchParams;
      const bumper = {
        id: 'bumper-one',
        name: params.get('name') ?? '',
        position: 'intro' as const,
        version: 1,
        key: 'intro',
        url: '/media/intro.wav',
        durationSeconds: 2,
        size: 96044,
      };
      settings = { ...settings, bumpers: [bumper] };
      return send({ bumper }, 201);
    }
    if (path === '/agent-tokens') {
      if (method === 'GET') return send({ tokens });
      const input = request.postDataJSON();
      const record: AgentTokenRecord = {
        id: 'token-one',
        name: input.name,
        prefix: 'hisfm_once',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + input.expiresInDays * 86400000).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      };
      tokens = [record];
      return send({ record, token: 'hisfm_one_time_plaintext_for_test' }, 201);
    }
    if (path.startsWith('/agent-tokens/')) {
      tokens = tokens.map((record) => ({ ...record, revokedAt: new Date().toISOString() }));
      return send(null, 204);
    }
    if (path === '/production-settings') {
      if (method === 'PUT') settings = { ...settings, ...request.postDataJSON() };
      return send({ settings });
    }
    if (path === '/production-settings/preview') {
      if (failPreview) {
        failPreview = false;
        return send({ error: '试听生成暂时失败，请重试' }, 502);
      }
      const input = request.postDataJSON();
      return send({ preview: { ...input, url: '/media/preview.wav', durationSeconds: 18, cached: false } });
    }
    if (path === '/productions') {
      if (method === 'POST') {
        production = fixture({ ...request.postDataJSON(), id: 'new-production' });
        return send({ production }, 201);
      }
      return send({ productions: [production] });
    }
    if (path.endsWith('/prompts'))
      return send({
        brief: '核实素材并保留我的创作意图',
        script: '根据已经批准的选题编写逐字稿',
        cover: '绘制节目封面',
        description: '整理发布简介',
      });
    if (path === '/episodes')
      return send({
        episodes: [
          {
            ...production,
            status: 'published',
            durationSeconds: 600,
            coverUrl: '/media/cover.png',
            audioUrl: '/media/audio.wav',
            showNotes: production.description,
            featured: false,
            publishedAt: production.updatedAt,
            sourceProductionId: production.id,
          },
        ],
      });
    if (path.startsWith('/episodes/'))
      return send({
        episode: {
          ...production,
          status: 'published',
          durationSeconds: 600,
          coverUrl: '/media/cover.png',
          audioUrl: '/media/audio.wav',
          showNotes: production.description,
          featured: false,
          publishedAt: production.updatedAt,
          sourceProductionId: production.id,
        },
      });
    if (method === 'GET') {
      if (production.audioJob?.status === 'queued' && ++audioPolls >= 1) {
        const ready = readyFixture();
        production = {
          ...production,
          version: production.version + 1,
          assets: { ...production.assets, audio: ready.assets.audio },
          audioJob: ready.audioJob,
        };
      }
      return send({ production });
    }
    if (method === 'DELETE') {
      expect(new URL(request.url()).searchParams.get('version')).toBe(String(production.version));
      return send(null, 204);
    }
    if (path.endsWith('/assets/cover')) {
      expect(new URL(request.url()).searchParams.get('version')).toBe(String(production.version));
      if (failUpload) {
        failUpload = false;
        return send({ error: '上传失败，请重试' }, 503);
      }
      production = {
        ...production,
        version: production.version + 1,
        assets: { ...production.assets, cover: readyFixture().assets.cover },
      };
      return send({ production });
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
      production = applyAction(
        action.changes ? applyPatch(production, action.changes, human) : production,
        action,
        human,
      );
      production = { ...production, version: production.version + 1 };
      return send({ production });
    }
    if (path.endsWith('/audio')) {
      production = {
        ...production,
        version: production.version + 1,
        audioJob: {
          ...readyFixture().audioJob,
          id: 'test-job',
          status: 'queued',
          scriptVersion: 1,
          createdAt: new Date().toISOString(),
          error: null,
        },
      };
      return send({ production }, 202);
    }
    if (path.endsWith('/publications')) {
      production = {
        ...production,
        version: production.version + 1,
        publications: [
          ...production.publications,
          { ...input, confirmedAt: new Date().toISOString(), confirmedBy: 'editor@his.fm' },
        ],
      };
      return send({ production });
    }
    const { version: _, ...fields } = input;
    production = { ...applyPatch(production, fields, human), version: production.version + 1 };
    return send({ production });
  });
  return {
    get production() {
      return production;
    },
    get actions() {
      return actions;
    },
    configureTts: () => {
      settings.ttsConfigured = true;
      settings.providers = { gemini: true, elevenlabs: true };
      ai.providers.gemini = true;
      ai.providers.elevenlabs = true;
    },
    failPreview: () => {
      failPreview = true;
    },
    conflict: () => {
      conflict = true;
    },
    failSave: () => {
      failSave = true;
    },
    failUpload: () => {
      failUpload = true;
    },
  };
}

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
  await page.goto(`/admin/productions/${production.id}?step=review`);
  await expect(page.locator('.studio-cover')).toHaveAttribute('src', production.assets.cover?.url ?? '');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载封面成品' }).click();
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
  await expect(page.getByRole('status')).toContainText('原图保持不变');
  expect(state.production).toEqual(before);
  expect(writes).toEqual([]);
  await page.route('**/brand/cover-frame.svg', (route) => route.fulfill({ status: 503, body: '' }));
  await page.reload();
  await page.getByRole('button', { name: '下载封面成品' }).click();
  await expect(page.getByRole('alert')).toContainText('封面或品牌框架未能加载');
  expect(state.production).toEqual(before);
});

test('five stages preserve failed edits and advance with owner completion', async ({ page, context }) => {
  const state = await studio(page);
  state.configureTts();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin');
  await page.getByRole('link', { name: '新建制作', exact: true }).click();
  await page.getByLabel('节目标题', { exact: true }).fill('制作工作台完整验收');
  await page.getByLabel('链接名称', { exact: true }).fill('studio-acceptance');
  await page.getByLabel('创作意图', { exact: true }).fill('讲清楚工作与生活的边界');
  await page.getByRole('button', { name: '添加素材' }).click();
  await page.getByRole('combobox', { name: '素材 1 类型' }).click();
  await page.getByRole('option', { name: '文本素材', exact: true }).click();
  await page.getByLabel('素材正文', { exact: true }).fill('一份经过核实的真实素材');
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect(page).toHaveURL(/\/productions\/new-production$/);
  await page.getByRole('button', { name: '标记选题完成', exact: true }).click();
  await expect(page.getByRole('tab', { name: '选题，已完成', exact: true })).toHaveAttribute(
    'data-complete',
    'true',
  );
  await expect(page.getByRole('complementary', { name: '主控对话' })).toBeVisible();
  await page
    .getByRole('textbox', { name: '完整逐字稿', exact: true })
    .fill('这份逐字稿在版本冲突时应该保留。');
  state.conflict();
  await page.getByRole('button', { name: '保存逐字稿', exact: true }).click();
  await expect(page.getByText('内容已更新，请刷新后重试', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '完整逐字稿', exact: true })).toContainText(
    '这份逐字稿在版本冲突时应该保留。',
  );
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认加载最新版本' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page
    .getByRole('textbox', { name: '完整逐字稿', exact: true })
    .fill('## 晚饭之前\n\n你好，欢迎收听 his.fm。\n\n今晚先吃饭。');
  await page.getByRole('button', { name: '标记逐字稿完成', exact: true }).click();
  await expect(page.getByRole('tab', { name: '逐字稿，已完成', exact: true })).toHaveAttribute(
    'data-complete',
    'true',
  );
  await expect(page.getByRole('textbox', { name: '完整逐字稿', exact: true })).toBeHidden();
  await page.getByRole('tab', { name: '发布文案', exact: true }).click();
  await page.getByLabel('节目摘要', { exact: true }).fill('一次关于工作边界的对话');
  await page.getByLabel('发布简介', { exact: true }).fill('## 本期内容\n\n**先吃饭**，再继续工作。');
  await page.getByRole('button', { name: '保存发布文案' }).click();
  const cover = {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh14AAAAASUVORK5CYII=',
      'base64',
    ),
  };
  await page.getByRole('tab', { name: '封面', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择封面: 上传节目封面' })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(cover);
  state.failUpload();
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await expect(page.getByText('上传失败，请重试', { exact: true })).toBeVisible();
  await expect(page.getByText('cover.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await page.getByRole('tab', { name: '音频', exact: true }).click();
  await page.getByRole('button', { name: '生成正文音频', exact: true }).click();
  await expect(page.getByText('音频制作完成', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '标记成品制作完成', exact: true }).click();
  await expect(page.locator('audio:visible')).toHaveCount(1);
  await expect(page.getByText('一次关于工作边界的对话', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '标记最终检查完成', exact: true }).click();
  await expect(page.getByText('展开公众号正文预览', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制微信公众号格式' }).click();
  await expect
    .poll(() => page.evaluate(async () => (await navigator.clipboard.read())[0].types))
    .toContain('text/html');
  await page.getByRole('tab', { name: '小宇宙', exact: true }).click();
  await page.getByRole('button', { name: '复制小宇宙纯文本' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('本期内容\n\n先吃饭，再继续工作。');
  await page.getByLabel('已发布的节目链接').fill('https://mp.weixin.qq.com/s/studio-acceptance');
  await page.getByRole('button', { name: '记录已发布', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认记录此次发布' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  expect(state.production.publications).toHaveLength(1);
  await expect(page.locator('.studio-step-nav [data-complete=true]')).toHaveCount(5);
  await mkdir('.local', { recursive: true });
  await page.getByRole('heading', { name: '制作工作台完整验收', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/studio-ready.png', fullPage: true });
  await page.getByRole('tab', { name: '逐字稿，已完成', exact: true }).click();
  await page.getByRole('button', { name: '重新打开本阶段', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '重新打开本阶段', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByRole('tab', { name: '逐字稿', exact: true })).toHaveAttribute(
    'data-complete',
    'false',
  );
  expect(state.production.stage).toBe('scripting');
  expect(state.production.assets.audio).not.toBeNull();
  const scriptPanel = page.getByRole('tabpanel', { name: '逐字稿', exact: true });
  const manuscript = scriptPanel.getByRole('textbox', { name: '完整逐字稿', exact: true });
  const savedScript = '## 晚饭之前\n\n你好，欢迎收听 his.fm。\n\n今晚先吃饭。';
  await expect(scriptPanel).toBeVisible();
  await expect(scriptPanel.getByRole('radio', { name: '编辑', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(manuscript).toBeVisible();
  await expect.poll(() => manuscript.locator('.cm-line').allTextContents()).toEqual(savedScript.split('\n'));
  await scriptPanel.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(manuscript).not.toContainText('今晚先吃饭');
  await scriptPanel.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => manuscript.locator('.cm-line').allTextContents()).toEqual(savedScript.split('\n'));
  expect(errors).toEqual([]);
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
  await expect(page.locator('audio[src="/media/intro.wav"]')).toBeVisible();
  await page.goto('/admin/connections');
  const origin = new URL(page.url()).origin;
  await expect(page.getByRole('link', { name: '接入说明', exact: true })).toHaveAttribute(
    'href',
    `${origin}/api/agent/instructions`,
  );
  await page.getByLabel('助手名称').fill('Hermes');
  await page.getByLabel('有效天数').fill('7');
  await page.getByRole('button', { name: '创建助手令牌', exact: true }).click();
  await expect(page.getByLabel('新建助手令牌')).toHaveValue('hisfm_one_time_plaintext_for_test');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('hisfm_one_time');
  await page.reload();
  await expect(page.getByLabel('新建助手令牌')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销 Hermes' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认撤销令牌' }).click();
  await expect(page.getByRole('button', { name: '撤销 Hermes' })).toHaveCount(0);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/studio-settings.png', fullPage: true });
});

test('catalog snapshots expose production links and never expose editing or deletion', async ({ page }) => {
  await studio(page, readyFixture());
  await page.goto('/admin/catalog');
  await expect(page.getByRole('button', { name: /^删除 / })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^打开制作 / })).toHaveAttribute(
    'href',
    '/admin/productions/production-test',
  );
  await page.goto('/admin/episodes/production-test');
  await expect(page.getByRole('link', { name: '打开制作记录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存节目' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '给主控的消息' })).toBeVisible();
});

test('stage changes keep the shell fixed and reset only the content island', async ({ page }) => {
  const state = await studio(page, fixture({ transcript: '先放下屏幕，好好吃一顿饭。\n\n'.repeat(180) }));
  for (const viewport of [
    { width: 1512, height: 982 },
    { width: 393, height: 852 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/admin/productions/production-test?step=script');
    const steps = page.getByRole('tablist', { name: '节目制作阶段' });
    const island = page.locator('.admin-content-island');
    const header = page.locator('#main-content > header');
    await expect(steps).toBeVisible();
    const initialHeader = await header.boundingBox();
    const initialIsland = await island.boundingBox();
    for (const name of ['选题', '成品制作', '最终检查', '发布', '逐字稿']) {
      await steps.getByRole('tab', { name, exact: true }).click();
      await expect(steps.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-current', 'step');
      expect(await header.boundingBox()).toEqual(initialHeader);
      expect(await island.boundingBox()).toEqual(initialIsland);
      expect(await page.locator('.admin-shell').evaluate((element) => element.scrollTop)).toBe(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
    await island.evaluate((element) => element.scrollTo({ top: 800 }));
    await expect.poll(() => island.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.goBack();
    await expect(steps.getByRole('tab', { name: '发布', exact: true })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect.poll(() => island.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await header.boundingBox()).toEqual(initialHeader);
    expect(await island.boundingBox()).toEqual(initialIsland);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  expect(state.actions).toEqual([]);
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
  await page.goto('/admin/productions/production-test?step=brief');
  await expect(page.getByRole('complementary', { name: '主控对话' })).toBeVisible();
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
  await expect(page.getByRole('tablist', { name: '节目制作阶段' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '选题', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: '返回选题', exact: true }).click();
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect.poll(() => state.production.sources.length).toBe(2);
  expect(state.production.title).toBe('保留选题的未保存标题');
  expect(state.production.intent).toBe('保留正在思考的切入点');
  expect(state.production.sources[0].content).toBe(edited);
  await page.goto('/admin/productions/production-test?step=brief&source=source-1');
  await expectDraft();
  expect(await page.locator('.admin-shell').evaluate((el) => el.scrollTop)).toBe(0);
  await page.goto('/admin/productions/production-test?step=brief&source=missing-source');
  await expect(page.getByText('这份素材尚未保存或已被移除，请返回选题查看素材列表。')).toBeVisible();
  await page.getByRole('button', { name: '返回选题', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
});

test('phone studio navigation, dark theme and settings remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await studio(page, readyFixture());
  await page.goto('/admin');
  const menu = page.getByRole('button', { name: '打开导航', exact: true });
  await menu.click();
  const drawer = page.getByRole('dialog', { name: '工作室导航' });
  await expect(drawer.getByRole('region', { name: '节目制作', exact: true })).toBeVisible();
  await expect(drawer.getByRole('region', { name: '素材与声音', exact: true })).toBeVisible();
  await expect(drawer.getByRole('region', { name: '工作室', exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'AI 设置', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/studio-mobile-dark.png', fullPage: true });
});

test('provider cards use distinct tints and local SVG marks in both themes and viewports', async ({
  page,
}) => {
  await studio(page);
  await page.routeWebSocket('**/admin/api/agent/live?protocol=1', () => {});
  await page.goto('/admin/ai');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => localStorage.setItem('hisfm-theme', theme), theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of ['ai', 'voices']) {
        await page.goto(`/admin/${route}`);
        const cards = page.locator('.studio-provider-card');
        await expect(cards).toHaveCount(route === 'ai' ? 2 : 10);
        const gemini = cards.filter({ has: page.locator('.studio-provider-mark[data-provider="gemini"]') });
        const elevenlabs = cards.filter({
          has: page.locator('.studio-provider-mark[data-provider="elevenlabs"]'),
        });
        await expect(gemini.first()).toContainText('Gemini');
        await expect(elevenlabs.first()).toContainText('ElevenLabs');
        const tint = (provider: typeof cards) =>
          provider.first().evaluate((element) => getComputedStyle(element).backgroundImage);
        expect(await tint(gemini)).not.toBe(await tint(elevenlabs));
        expect(await tint(gemini)).toContain('linear-gradient');
        for (const provider of [gemini, elevenlabs]) {
          expect(
            await provider.first().evaluate((element) => {
              const style = getComputedStyle(element);
              const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
              const base = rgb(style.backgroundColor);
              const accent = rgb(style.backgroundImage.match(/rgba?\([^)]+\)/)?.[0] ?? '');
              const background = base.map(
                (channel, index) => channel * (1 - accent[3]) + accent[index] * accent[3],
              );
              const foreground = rgb(
                getComputedStyle(element.querySelector('.admin-muted') ?? element).color,
              );
              const luminance = (channels: number[]) =>
                channels.reduce((sum, channel, index) => {
                  const value = channel / 255;
                  return (
                    sum +
                    (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
                      [0.2126, 0.7152, 0.0722][index]
                  );
                }, 0);
              const values = [luminance(background), luminance(foreground)].sort((a, b) => a - b);
              return (values[1] + 0.05) / (values[0] + 0.05);
            }),
          ).toBeGreaterThanOrEqual(4.5);
          const mark = provider.first().locator('.studio-provider-mark > span');
          expect(
            await mark.evaluate(async (element) => {
              const source = getComputedStyle(element).maskImage.match(/^url\("?(.*?)"?\)$/)?.[1];
              if (
                !source ||
                (!source.startsWith('data:image/svg+xml') && new URL(source).origin !== location.origin)
              )
                return false;
              const image = new Image();
              image.src = source;
              await image.decode();
              return image.naturalWidth > 0;
            }),
          ).toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
});

test('voice references use six CDN samples and selecting a voice preserves speaking style', async ({
  page,
}) => {
  await studio(page);
  await page.goto('/admin/voices');
  const samples = page.locator('audio');
  await expect(samples).toHaveCount(6);
  for (const voice of ['Kore', 'Zephyr', 'Puck', 'Charon', 'Aoede', 'Orus']) {
    const sample = page.getByLabel(`${voice} 音色样片`, { exact: true });
    await expect(sample).toHaveAttribute('src', `https://f.no.mt/reference/voices/${voice}.wav`);
    await expect(sample).toHaveAttribute('preload', 'none');
  }
  const pauses = await page.evaluate(() => {
    const samples = [...document.querySelectorAll('audio')];
    let pauses = 0;
    samples[0].pause = () => {
      pauses++;
    };
    samples[0].dispatchEvent(new Event('play'));
    samples[1].dispatchEvent(new Event('play'));
    return pauses;
  });
  expect(pauses).toBe(1);
  const request = page.waitForRequest(
    (request) => request.url().endsWith('/ai-settings') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: '使用 Puck 音色', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    settings: { gemini: { voice: 'Puck' }, speakingStyle: defaultSpeechSettings.speakingStyle },
  });
  await expect(page.getByRole('button', { name: '使用 Kore 音色', exact: true })).toBeEnabled();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/studio-voices.png', fullPage: true });
});

test('real local API persists a production through human review and cleans it up', async ({ page }) => {
  const slug = `studio-e2e-${randomUUID()}`;
  let id = '';
  await page.goto('/login');
  await page.getByRole('button', { name: '进入本地工作室' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  try {
    await page.locator('header').getByRole('link', { name: '新建制作', exact: true }).click();
    await page.getByLabel('节目标题', { exact: true }).fill('真实接口制作流程验收');
    await page.getByLabel('链接名称', { exact: true }).fill(slug);
    await page.getByLabel('期数', { exact: true }).fill('99008');
    await page.getByLabel('创作意图', { exact: true }).fill('验证人工审阅与创作流程，测试后清理。');
    await page.getByRole('button', { name: '添加素材' }).click();
    await page.getByLabel('HTTPS 链接', { exact: true }).fill('https://example.com/reference');
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
    await page.getByRole('button', { name: '标记选题完成', exact: true }).click();
    await page
      .getByRole('textbox', { name: '完整逐字稿', exact: true })
      .fill('你好，这是本地工作室的真实接口验收稿。');
    await page.getByRole('button', { name: '标记逐字稿完成', exact: true }).click();
    await page.getByRole('tab', { name: '选题，已完成', exact: true }).click();
    await page.getByLabel('创作意图', { exact: true }).fill('调整选题，已有逐字稿必须保留。');
    await page.getByRole('button', { name: '保存选题', exact: true }).click();
    await expect(page.getByRole('tab', { name: '选题', exact: true })).toHaveAttribute(
      'data-complete',
      'false',
    );
    await expect(page.getByRole('tab', { name: '逐字稿', exact: true })).toHaveAttribute(
      'data-complete',
      'false',
    );
    await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
    await page.reload();
    await expect(page.locator('.studio-transcript:visible')).toHaveText(
      '你好，这是本地工作室的真实接口验收稿。',
    );
    await expect(page.getByRole('button', { name: '标记逐字稿完成', exact: true })).toBeDisabled();
    await mkdir('.local', { recursive: true });
    await page.getByRole('heading', { name: '真实接口制作流程验收', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.local/studio-real-api.png', fullPage: true });
  } finally {
    if (id) {
      const status = await page.evaluate(async (id) => {
        const { production } = (await (await fetch(`/admin/api/productions/${id}`)).json()) as {
          production: { version: number };
        };
        return (
          await fetch(`/admin/api/productions/${id}?version=${production.version}`, { method: 'DELETE' })
        ).status;
      }, id);
      expect(status).toBe(204);
    }
  }
});

test('environment switch retains Basalt segment typography on desktop and phone', async ({ page }) => {
  await studio(page);
  await page.routeWebSocket('**/admin/api/agent/live?protocol=1', () => {});
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
      await expect(segment).toHaveCSS('font-size', '11px');
      await expect(segment).toHaveCSS('font-weight', '600');
      await expect(segment).toHaveCSS('letter-spacing', '0.275px');
      await expect(segment).toHaveCSS(
        'font-family',
        await page.locator('.admin-app').evaluate((element) => getComputedStyle(element).fontFamily),
      );
    }
  }
  await expect(environment.getByRole('radio', { name: 'Local', exact: true })).toBeChecked();
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
  await page.getByRole('button', { name: '刷新制作列表' }).click();
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

test('imported draft materials are readable before approval and platform timestamps are independent', async ({
  page,
}) => {
  const publication = {
    platform: 'wechat' as const,
    url: 'https://mp.weixin.qq.com/s/reference',
    publishedAt: '2026-09-25T07:00:00.000Z',
    confirmedAt: '2026-09-25T08:00:00.000Z',
    confirmedBy: 'editor',
    version: 1,
  };
  await studio(
    page,
    fixture({
      transcript: '已导入的真实逐字稿，可在选题阶段阅读。',
      summary: '已导入的节目摘要',
      description: '已导入的研究与发布简介',
      publications: [publication, { ...publication, publishedAt: '2026-09-24T07:00:00.000Z', version: 2 }],
    }),
  );
  await page.goto('/admin');
  const table = page.getByRole('table', { name: '节目制作列表' });
  await expect(table.getByText('小宇宙 · 未发布', { exact: true })).toBeVisible();
  await expect(table.locator('time')).toHaveAttribute('datetime', publication.publishedAt);
  await page.getByRole('link', { name: '下一条提示之前，先吃饭', exact: true }).click();
  await expect(page.getByText('已导入的真实逐字稿，可在选题阶段阅读。', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
  await expect(page.locator('.studio-transcript:visible')).toHaveText(
    '已导入的真实逐字稿，可在选题阶段阅读。',
  );
  await expect(page.getByRole('textbox', { name: '完整逐字稿', exact: true })).toBeHidden();
  await page.getByRole('tab', { name: '成品制作', exact: true }).click();
  await page.getByRole('tab', { name: '发布文案', exact: true }).click();
  await expect(page.getByLabel('节目摘要', { exact: true })).toHaveValue('已导入的节目摘要');
  await expect(page.getByRole('region', { name: '发布简介预览' })).toHaveText('已导入的研究与发布简介');
  await page.getByRole('tab', { name: '发布', exact: true }).click();
  await expect(page.getByRole('button', { name: '记录已发布', exact: true })).toBeDisabled();
});

test('phone stages preserve drafts on canceled navigation and grow long text without nested scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const text = `# 今晚先吃饭\n\n${'工作结束之后，给自己留下一段散步的时间。\n\n'.repeat(60)}`;
  const state = await studio(page, readyFixture({ transcript: text }));
  await page.goto('/admin/productions/production-test?step=script');
  await expect(page.locator('.studio-transcript h1')).toHaveText('今晚先吃饭');
  const reader = await page.locator('.studio-transcript:visible').evaluate(async (element) => {
    await document.fonts.ready;
    return {
      font: getComputedStyle(element).fontFamily,
      loaded: document.fonts.check('18px TsangerJinKai02', '今晚先吃饭'),
      height: element.clientHeight,
      scroll: element.scrollHeight,
    };
  });
  expect(reader.font).toContain('TsangerJinKai02');
  expect(reader.loaded).toBe(true);
  expect(reader.scroll).toBeLessThanOrEqual(reader.height + 1);
  await page.locator('.studio-stage:visible').getByRole('radio', { name: '编辑', exact: true }).click();
  const input = page.getByRole('textbox', { name: '完整逐字稿', exact: true });
  await input.fill(`${text}留下这个未保存的结尾。`);
  const size = await input.evaluate((element) => ({
    height: element.clientHeight,
    scroll: element.scrollHeight,
  }));
  expect(size.height).toBeGreaterThan(1000);
  expect(size.scroll).toBeLessThanOrEqual(size.height + 1);
  await page.getByRole('tab', { name: '成品制作，已完成', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveCount(0);
  await expect(input).toBeHidden();
  await page.getByRole('tab', { name: '逐字稿，已完成', exact: true }).click();
  await page.locator('.studio-stage:visible').getByRole('radio', { name: '预览', exact: true }).click();
  await expect(page.locator('.studio-transcript:visible')).toContainText('留下这个未保存的结尾。');
  expect(state.actions).toHaveLength(0);
  await page.getByRole('tab', { name: '成品制作，已完成', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(input).toBeHidden();
  await page.getByRole('tab', { name: '发布文案', exact: true }).click();
  await page.locator('.studio-stage:visible').getByRole('radio', { name: '编辑', exact: true }).click();
  await page.getByLabel('节目摘要', { exact: true }).fill('跨素材切换仍然保留的摘要');
  await page.getByRole('tab', { name: '封面', exact: true }).click();
  await page.getByRole('tab', { name: '发布文案', exact: true }).click();
  await expect(page.getByLabel('节目摘要', { exact: true })).toHaveValue('跨素材切换仍然保留的摘要');
  await page.getByRole('button', { name: '保存发布文案', exact: true }).click();
  await expect(page.getByRole('tab', { name: '最终检查', exact: true })).toHaveAttribute(
    'data-complete',
    'false',
  );
  await page.getByRole('tab', { name: '逐字稿，已完成', exact: true }).click();
  await expect(page.locator('.studio-transcript:visible')).toContainText('留下这个未保存的结尾');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const nested = await page
    .locator('.studio-stage:visible')
    .evaluate(
      (element) =>
        [...element.querySelectorAll('*')].filter(
          (node) =>
            /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1,
        ).length,
    );
  expect(nested).toBe(0);
  await page.screenshot({ path: '.local/studio-mobile-reader.png' });
});

test('voice settings and per-generation choices offer optional previews without changing defaults', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const state = await studio(
    page,
    readyFixture({ stage: 'production', assets: { cover: null, audio: null }, audioJob: null }),
  );
  state.configureTts();
  await page.goto('/admin/narration');
  await page.getByRole('combobox', { name: '讲述声音', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(30);
  await page.getByRole('option', { name: 'Sulafat · 温暖', exact: true }).click();
  await page.getByLabel('讲述风格', { exact: true }).fill('平静、自然的普通话');
  state.failPreview();
  await page.getByRole('button', { name: '生成试听预览', exact: true }).click();
  await expect(page.getByText('试听生成暂时失败，请重试', { exact: true })).toBeVisible();
  await expect(page.getByLabel('讲述风格', { exact: true })).toHaveValue('平静、自然的普通话');
  await page.getByRole('button', { name: '生成试听预览', exact: true }).click();
  await expect(page.getByLabel('本次生成的试听预览')).toHaveAttribute('src', '/media/preview.wav');
  await page.getByRole('button', { name: '保存旁白风格', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存旁白风格', exact: true })).toBeEnabled();
  await page.goto('/admin/productions/production-test?step=assets');
  await page.getByRole('tab', { name: '音频', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '讲述声音', exact: true })).toContainText('Sulafat');
  await expect(page.getByRole('combobox', { name: '片头', exact: true })).toContainText('不添加');
  await expect(page.getByRole('button', { name: '生成正文音频', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '生成试听预览', exact: true }).click();
  await expect(page.getByLabel('本次生成的试听预览')).toBeVisible();
  await page.getByRole('combobox', { name: '讲述声音', exact: true }).click();
  await page.getByRole('option', { name: 'Vindemiatrix · 温柔', exact: true }).click();
  await expect(page.getByLabel('本次生成的试听预览')).toHaveCount(0);
  const generated = page.waitForRequest(
    (request) => request.url().endsWith('/audio') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: '生成正文音频', exact: true }).click();
  expect((await generated).postDataJSON()).toMatchObject({
    voice: 'Vindemiatrix',
    speakingStyle: '平静、自然的普通话',
    introId: null,
    outroId: null,
  });
  await expect(page.getByText('音频制作完成', { exact: true })).toBeVisible();
  await page.goto('/admin/narration');
  await expect(page.getByRole('combobox', { name: '讲述声音', exact: true })).toContainText('Sulafat');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/audio-settings-mobile.png', fullPage: true });
});

test('publication copies WeChat formatting with the same cover and references as its preview', async ({
  page,
  context,
}) => {
  const transcript =
    '## 一个具体的问题\n\n**生活细节**，参考[项目文档](https://example.com/docs)。\n\n> 留下自己的时间。';
  await studio(page, readyFixture({ transcript }));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin/productions/production-test?step=publish');
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
