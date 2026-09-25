import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import type {
  AgentTokenRecord,
  Production,
  ProductionAction,
  ProductionSettings,
} from '../../src/shared/production';
import { fixture, readyFixture } from '../worker/production-fixture';

async function studio(page: Page, initial = fixture()) {
  let production = initial;
  let conflict = false;
  let failUpload = false;
  let audioPolls = 0;
  let settings: ProductionSettings = {
    voice: 'Kore',
    speakingStyle: '自然地讲述',
    intro: null,
    outro: null,
    ttsConfigured: false,
  };
  let tokens: AgentTokenRecord[] = [];
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
    if (path.startsWith('/production-settings/')) {
      if (failUpload) {
        failUpload = false;
        return send({ error: '上传失败，请重试' }, 503);
      }
      const key = path.endsWith('/intro') ? 'intro' : 'outro';
      settings = { ...settings, [key]: { key, url: `/media/${key}.wav`, durationSeconds: 2, size: 96044 } };
      return send({ settings });
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
    if (conflict) {
      conflict = false;
      production = { ...production, version: production.version + 1 };
      return send({ error: '内容已更新，请刷新后重试' }, 409);
    }
    expect(input.version).toBe(production.version);
    if (path.endsWith('/actions')) {
      actions.push(input);
      const stages: Partial<Record<ProductionAction['action'], Production['stage']>> = {
        submit_brief: 'brief_review',
        approve_brief: 'scripting',
        revise_brief: 'draft',
        submit_script: 'script_review',
        approve_script: 'production',
        revise_script: 'scripting',
        submit_final: 'final_review',
        approve_final: 'ready',
        revise_assets: 'production',
        reopen_assets: 'production',
        reopen_script: 'scripting',
        reopen_brief: 'draft',
      };
      const action = input as ProductionAction;
      production = {
        ...production,
        stage: stages[action.action] ?? production.stage,
        version: production.version + 1,
      };
      const approval = { by: 'editor@his.fm', at: new Date().toISOString() };
      if (action.action === 'approve_script')
        production = {
          ...production,
          scriptVersion: 1,
          approvals: { ...production.approvals, script: approval },
        };
      if (action.action === 'approve_brief') production.approvals.brief = approval;
      if (action.action === 'approve_final') production.approvals.final = approval;
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
    production = { ...production, ...input, version: production.version + 1 };
    return send({ production });
  });
  return {
    get production() {
      return production;
    },
    get actions() {
      return actions;
    },
    conflict: () => {
      conflict = true;
    },
    failUpload: () => {
      failUpload = true;
    },
  };
}

async function confirmAction(page: Page, label: string, feedback?: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  if (feedback) await dialog.getByLabel('修改意见').fill(feedback);
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('complete studio workflow preserves failed edits and requires human approvals', async ({
  page,
  context,
}) => {
  const state = await studio(page);
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
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect(page).toHaveURL(/\/productions\/new-production$/);
  await confirmAction(page, '提交选题审核');
  await confirmAction(page, '人工确认选题');
  await page.getByRole('button', { name: '复制 Hermes 逐字稿提示词' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('已');
  await page.getByLabel('完整逐字稿').fill('这份逐字稿在版本冲突时应该保留。');
  state.conflict();
  await page.getByRole('button', { name: '保存逐字稿', exact: true }).click();
  await expect(page.getByText('内容已更新，请刷新后重试', { exact: true })).toBeVisible();
  await expect(page.getByLabel('完整逐字稿')).toHaveValue('这份逐字稿在版本冲突时应该保留。');
  await page.getByRole('button', { name: '加载最新版本' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认加载最新版本' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.getByLabel('完整逐字稿').fill('## 晚饭之前\n\n你好，欢迎收听 his.fm。');
  await page.getByRole('button', { name: '保存逐字稿', exact: true }).click();
  await confirmAction(page, '提交逐字稿审核');
  await confirmAction(page, '退回修改逐字稿', '补充结尾的具体建议');
  expect(state.actions.at(-1)?.feedback).toBe('补充结尾的具体建议');
  await page.getByLabel('完整逐字稿').fill('## 晚饭之前\n\n你好，欢迎收听 his.fm。\n\n今晚先吃饭。');
  await page.getByRole('button', { name: '保存逐字稿', exact: true }).click();
  await confirmAction(page, '提交逐字稿审核');
  await confirmAction(page, '人工批准逐字稿');
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
  await expect(page.getByRole('button', { name: '选择封面: 上传节目封面' })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(cover);
  state.failUpload();
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await expect(page.getByText('上传失败，请重试', { exact: true })).toBeVisible();
  await expect(page.getByText('cover.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await page.getByRole('button', { name: '生成完整音频', exact: true }).click();
  await expect(page.getByText('音频制作完成', { exact: true })).toBeVisible();
  await confirmAction(page, '提交成品审核');
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.getByText('一次关于工作边界的对话', { exact: true })).toBeVisible();
  await confirmAction(page, '人工确认全部成品');
  await expect(page.getByTitle('微信公众号排版预览')).toBeVisible();
  await page.getByRole('button', { name: '复制公众号富文本' }).click();
  await expect
    .poll(() => page.evaluate(async () => (await navigator.clipboard.read())[0].types))
    .toContain('text/html');
  await page.getByRole('tab', { name: '小宇宙', exact: true }).click();
  await page.getByRole('button', { name: '复制小宇宙纯文本' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('本期内容\n\n先吃饭，再继续工作。');
  await page.getByLabel('已发布的节目链接').fill('https://mp.weixin.qq.com/s/studio-acceptance');
  await page.getByRole('button', { name: '人工确认已发布', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认记录此次发布' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  expect(state.production.publications).toHaveLength(1);
  await mkdir('.local', { recursive: true });
  await page.getByRole('heading', { name: '制作工作台完整验收', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/studio-ready.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('audio settings preserve failed uploads and assistant tokens are revocable and transient', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/settings');
  await expect(page.getByText('Gemini 未配置', { exact: true })).toBeVisible();
  await page.getByLabel('讲述风格').fill('舒缓、温暖，留出自然停顿');
  await page.getByRole('button', { name: '保存声音设置' }).click();
  await expect(page.getByRole('button', { name: '选择片头: 上传片头' })).toBeEnabled();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'intro.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(96) });
  state.failUpload();
  await page.getByRole('button', { name: '上传片头', exact: true }).click();
  await expect(page.getByText('上传失败，请重试', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上传片头', exact: true }).click();
  await expect(page.locator('audio')).toHaveCount(1);
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
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('phone studio navigation, dark theme and settings remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await studio(page, readyFixture());
  await page.goto('/admin');
  const menu = page.getByRole('button', { name: '打开导航', exact: true });
  await menu.click();
  const drawer = page.getByRole('dialog', { name: '工作室导航' });
  await drawer.getByRole('button', { name: '工作室设置', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/studio-mobile-dark.png', fullPage: true });
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
    (request) => request.url().endsWith('/production-settings') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: '使用 Puck 音色', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ voice: 'Puck', speakingStyle: '自然地讲述' });
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
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/api/productions') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '保存选题', exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    id = (await created.json()).production.id;
    await expect(page).toHaveURL(new RegExp(`/admin/productions/${id}$`));
    await confirmAction(page, '提交选题审核');
    await confirmAction(page, '人工确认选题');
    await page.getByLabel('完整逐字稿').fill('你好，这是本地工作室的真实接口验收稿。');
    await page.getByRole('button', { name: '保存逐字稿', exact: true }).click();
    await confirmAction(page, '提交逐字稿审核');
    await confirmAction(page, '退回修改逐字稿', '请增加可核实的引用来源');
    await page.reload();
    await expect(page.getByLabel('完整逐字稿')).toHaveValue('你好，这是本地工作室的真实接口验收稿。');
    await page.getByText(/^查看全部记录/).click();
    await expect(page.getByText('请增加可核实的引用来源', { exact: true })).toBeVisible();
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
  const production = page.getByRole('radio', { name: '生产', exact: true });
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
  await expect(page.getByRole('radio', { name: '生产', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/studio-production-environment.png', fullPage: true });
  authorized = false;
  await page.getByRole('button', { name: '刷新制作列表' }).click();
  await expect(page.getByText('生产认证已失效', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '本地', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '本地', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: '下一条提示之前，先吃饭', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hisfm-admin-environment'))).toBe('local');
  expect(connectCalls).toBe(2);
  await expect(page.getByRole('radio', { name: '本地', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  failLogin = true;
  await page.getByRole('radio', { name: '生产', exact: true }).click();
  await expect(page.getByText('生产登录未完成，请重试', { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hisfm-admin-environment'))).toBe('local');
  failLogin = false;
  await page.getByRole('radio', { name: '生产', exact: true }).click();
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
  for (const text of ['已导入的真实逐字稿，可在选题阶段阅读。', '已导入的节目摘要', '已导入的研究与发布简介'])
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByLabel('完整逐字稿', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存发布文案' })).toHaveCount(0);
  await confirmAction(page, '提交选题审核');
  await expect(page.getByText('已导入的真实逐字稿，可在选题阶段阅读。', { exact: true })).toBeVisible();
  await expect(page.getByText('已导入的研究与发布简介', { exact: true })).toBeVisible();
});
