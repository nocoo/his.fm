import type { BrowserFrame, DraftProposal, FieldRef, PageContext, ServerFrame } from '@his-fm/contracts';
import { expect, type Page, test, type WebSocketRoute } from '@playwright/test';
import { fixture, readyFixture } from '../worker/production-fixture';

async function studio(
  page: Page,
  initial = fixture({
    transcript: 'A saved manuscript.',
    summary: 'Saved summary',
    description: 'Saved description',
  }),
) {
  let production = initial;
  const writes: unknown[] = [];
  const frames: BrowserFrame[] = [];
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('**/admin/api/agent/live?protocol=1', (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as BrowserFrame;
      frames.push(frame);
      if (frame.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      if (frame.type === 'context')
        socket.send(
          JSON.stringify({ type: 'context.ack', seq: frame.context.seq, tabId: frame.context.tabId }),
        );
      if (frame.type === 'command') {
        socket.send(JSON.stringify({ type: 'command.ack', id: frame.id }));
        socket.send(
          JSON.stringify({
            type: 'message',
            message: {
              id: frame.id,
              role: 'user',
              text: frame.text,
              commandId: frame.id,
              createdAt: new Date().toISOString(),
            },
          }),
        );
      }
      if (frame.type === 'proposal.ack') socket.send(JSON.stringify(frame));
    });
    socket.send(
      JSON.stringify({
        type: 'snapshot',
        online: true,
        messages: [],
        conversations: [],
        commands: [],
        proposals: [],
        deliveryId: 1,
      }),
    );
  });
  await page.route('**/admin/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (value: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (path.endsWith('/session')) return send({ mode: 'local', user: { email: 'editor@his.fm' } });
    if (path.endsWith('/productions/production-test')) {
      if (route.request().method() === 'PUT') {
        const input = route.request().postDataJSON();
        writes.push(input);
        production = { ...production, ...input, version: production.version + 1 };
      }
      return send({ production });
    }
    if (path.endsWith('/productions')) return send({ productions: [production] });
    return send({});
  });
  return {
    frames,
    sockets,
    writes,
    send(frame: ServerFrame) {
      sockets.at(-1)?.send(JSON.stringify(frame));
    },
    context() {
      return frames
        .filter((frame): frame is Extract<BrowserFrame, { type: 'context' }> => frame.type === 'context')
        .at(-1)?.context;
    },
    change(fields: Partial<typeof production>) {
      production = { ...production, ...fields, version: production.version + 1 };
      this.send({ type: 'production.changed', productionId: production.id, version: production.version });
    },
    proposal(context: PageContext, id = 'proposal', value = 'Improved manuscript.') {
      const proposal: DraftProposal = {
        id,
        commandId: 'command',
        context,
        target: context.field as FieldRef,
        value,
        summary: 'Improve the selected manuscript',
      };
      this.send({ type: 'proposal', proposal });
    },
  };
}

test('ambient coordinator keeps one connection across routes and excludes sensitive settings', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  await expect(page.getByRole('complementary', { name: '主控对话' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Local', exact: true })).toBeVisible();
  await expect
    .poll(() => state.frames.some((frame) => frame.type === 'delivery.ack' && frame.deliveryId === 1))
    .toBe(true);
  await expect.poll(() => state.context()?.step).toBe('brief');
  const epoch = state.context()?.pageEpoch ?? 0;
  await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
  await expect.poll(() => state.context()?.step).toBe('script');
  expect(state.context()?.pageEpoch).toBeGreaterThan(epoch);
  await page.getByRole('textbox', { name: '给主控的消息' }).fill('Review the current manuscript');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect
    .poll(() => state.frames.some((frame) => frame.type === 'command' && frame.context?.step === 'script'))
    .toBe(true);
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  await expect.poll(() => state.frames.some((frame) => frame.type === 'cancel')).toBe(true);
  await page.getByRole('button', { name: '工作室设置', exact: true }).click();
  await expect.poll(() => state.context()?.route).toBe('/admin/settings');
  expect(state.context()?.field).toBeNull();
  expect(state.context()?.draft).toBeNull();
  expect(state.sockets).toHaveLength(1);
  await expect(page.getByRole('button', { name: /开启|暂停|重新启用/ })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('dock collapses to a fab without losing drafts, live messages, roles or the connection', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  const sidebar = page.getByRole('complementary', { name: '主控对话' });
  const composer = page.getByRole('textbox', { name: '给主控的消息' });
  await expect(composer).toBeVisible();
  await page.getByLabel('节目标题', { exact: true }).fill('Unsaved episode title');
  await composer.fill('Unsent question');
  const task = 'Retrieve and compare a long set of references without changing the current draft';
  const conversations = [
    {
      id: 'root',
      role: '主控',
      lifetime: 'coordinator' as const,
      status: 'working' as const,
      task: '核对成果',
    },
    { id: 'writer', role: '写作', lifetime: 'task' as const, status: 'waiting' as const, task },
    {
      id: 'reviewer',
      role: '审校',
      lifetime: 'resident' as const,
      status: 'failed' as const,
      task: '来源无法读取',
    },
    { id: 'retired', role: '旧写作', lifetime: 'task' as const, status: 'retired' as const, task: '已结束' },
  ].map((role) => ({ ...role, model: 'private-model', thinkingLevel: 'high' }));
  state.send({ type: 'status', id: 'roles-initial', conversations });
  const roster = page.getByRole('region', { name: '运行角色 · 3' });
  await expect(roster.locator('.agent-role')).toHaveCount(3);
  await expect(roster).toContainText('工作中');
  await expect(roster).toContainText('等待中');
  await expect(roster).toContainText('失败');
  await expect(roster).not.toContainText('旧写作');
  await expect(roster).not.toContainText('private-model');
  const tops = await roster
    .locator('.agent-role')
    .evaluateAll((elements) => elements.map((e) => e.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);
  expect(await roster.evaluate((e) => e.getBoundingClientRect().height)).toBeLessThanOrEqual(78);
  expect(await sidebar.locator('.agent-header').evaluate((e) => e.clientHeight)).toBeLessThanOrEqual(48);
  const writer = roster.getByRole('button', { name: `写作 · 等待中 · ${task}` });
  await expect(writer.locator('.agent-role-task')).toHaveCSS('white-space', 'nowrap');
  await expect(writer.locator('.agent-role-task')).toHaveCSS('text-overflow', 'ellipsis');
  await writer.click();
  await expect(page.getByRole('dialog', { name: '写作任务详情' })).toContainText(task);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '写作任务详情' })).toHaveCount(0);
  await expect(sidebar).toBeVisible();
  await expect(writer).toBeFocused();
  const island = page.locator('.admin-content-island');
  const openWidth = await island.evaluate((e) => e.clientWidth);
  await page.getByRole('button', { name: '收起主控面板' }).click();
  await expect(sidebar).toHaveCount(0);
  const launcher = page.getByRole('button', { name: /展开主控面板/ });
  await expect(launcher).toBeFocused();
  await expect.poll(() => island.evaluate((e) => e.clientWidth)).toBeGreaterThan(openWidth + 300);
  state.send({
    type: 'message',
    message: {
      id: 'while-closed',
      role: 'assistant',
      text: 'Work continues while the panel is closed.',
      commandId: null,
      createdAt: '2026-10-04T00:00:00Z',
    },
  });
  state.send({
    type: 'command.state',
    id: 'pending-closed',
    commandId: 'ongoing',
    status: 'working',
    detail: 'Background task',
  });
  state.send({
    type: 'status',
    id: 'roles-updated',
    conversations: conversations.map((role) =>
      role.id === 'writer' ? { ...role, status: 'working' } : role,
    ),
  });
  await expect(launcher).toHaveAccessibleName('展开主控面板，1项任务进行中');
  await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
  await expect(sidebar).toHaveCount(0);
  await launcher.click();
  await expect(composer).toHaveValue('Unsent question');
  await expect(sidebar).toContainText('Work continues while the panel is closed.');
  await expect(roster.getByRole('button', { name: `写作 · 工作中 · ${task}` })).toBeVisible();
  await composer.focus();
  await composer.press('Escape');
  await expect(launcher).toBeFocused();
  await launcher.press('Enter');
  await expect(composer).toHaveValue('Unsent question');
  await page.getByRole('tab', { name: '选题', exact: true }).click();
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('Unsaved episode title');
  expect(state.sockets).toHaveLength(1);
  expect(state.frames.filter((frame) => frame.type === 'cancel' || frame.type === 'command')).toEqual([]);
  expect(await page.locator('.admin-shell').evaluate((e) => e.scrollTop)).toBe(0);
  expect(state.writes).toEqual([]);
});

test('phone dock gives height back to the editor and bounds many roles to one horizontal row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  const composer = page.getByRole('textbox', { name: '给主控的消息' });
  await composer.fill('Mobile draft');
  state.send({
    type: 'status',
    id: 'many-roles',
    conversations: Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      role: `写作${index + 1}`,
      lifetime: 'task',
      status: 'idle',
      task: '等待任务',
      model: 'fake',
      thinkingLevel: 'low',
    })),
  });
  const roster = page.getByRole('region', { name: '运行角色 · 12' });
  await expect(roster.locator('.agent-role')).toHaveCount(12);
  const geometry = await roster.evaluate((e) => ({
    height: e.clientHeight,
    width: e.clientWidth,
    scrollWidth: e.scrollWidth,
  }));
  expect(geometry.height).toBeLessThanOrEqual(66);
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.width);
  const island = page.locator('.admin-content-island');
  const height = await island.evaluate((e) => e.clientHeight);
  await page.getByRole('button', { name: '收起主控面板' }).click();
  await expect.poll(() => island.evaluate((e) => e.clientHeight)).toBeGreaterThan(height + 200);
  await expect(page.getByRole('button', { name: /展开主控面板/ })).toBeInViewport();
  await page.getByRole('button', { name: /展开主控面板/ }).click();
  await expect(composer).toHaveValue('Mobile draft');
  await expect(composer).toBeInViewport();
  await roster.locator('.agent-role').last().click();
  await expect(page.getByRole('dialog', { name: '写作12任务详情' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(composer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(state.sockets).toHaveLength(1);
  expect(state.writes).toEqual([]);
});

test('proposals mutate only the exact draft, retain undo, reject stale revisions and IME', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=script');
  await page.locator('.studio-stage:visible').getByRole('radio', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '完整逐字稿', exact: true });
  await editor.fill('My unsaved manuscript.');
  await expect.poll(() => state.context()?.draft?.value).toBe('My unsaved manuscript.');
  const original = structuredClone(state.context() as PageContext);
  state.proposal(original);
  await expect(editor).toHaveText('Improved manuscript.');
  await expect
    .poll(() => state.frames.some((frame) => frame.type === 'proposal.ack' && frame.status === 'applied'))
    .toBe(true);
  expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).toHaveText('My unsaved manuscript.');
  state.proposal(original, 'stale');
  await expect(editor).toHaveText('My unsaved manuscript.');
  await expect(page.getByRole('alert')).toContainText('未覆盖当前输入');
  await expect(page.getByRole('button', { name: '基于当前内容重写', exact: true })).toBeVisible();
  await editor.focus();
  await expect.poll(() => state.context()?.draft?.value).toBe('My unsaved manuscript.');
  const composing = structuredClone(state.context() as PageContext);
  await editor.dispatchEvent('compositionstart', { data: '中' });
  state.proposal(composing, 'ime');
  await expect
    .poll(() =>
      state.frames.some(
        (frame) => frame.type === 'proposal.ack' && frame.id === 'ime' && frame.status === 'stale',
      ),
    )
    .toBe(true);
  await editor.dispatchEvent('compositionend', { data: '中' });
  expect(state.writes).toEqual([]);
});

test('canonical changes refresh clean fields while dirty overlap remains explicit', async ({ page }) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  const title = page.getByLabel('节目标题', { exact: true });
  const slug = page.getByLabel('链接名称', { exact: true });
  await title.fill('My unsaved title');
  state.change({ title: 'Remote title', slug: 'remote-slug' });
  await expect(title).toHaveValue('My unsaved title');
  await expect(slug).toHaveValue('remote-slug');
  await expect(page.getByRole('alert')).toContainText('你的输入已保留');
  await expect(page.getByRole('button', { name: '保存选题', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保留我的输入', exact: true }).click();
  await page.getByRole('button', { name: '保存选题', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({ title: 'My unsaved title', slug: 'remote-slug', version: 2 });
});

test('stable source identity survives reordered canonical sources and reconnect preserves draft', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief&source=source-1');
  const title = page.getByLabel('素材标题', { exact: true });
  await title.fill('Unsaved source title');
  await expect.poll(() => state.context()?.field?.sourceId).toBe('source-1');
  state.change({
    sources: [
      { id: 'other', type: 'text', title: 'Other', content: 'Text' },
      { id: 'source-1', type: 'text', title: '生活记录', content: 'Fresh content' },
    ],
  });
  await expect(title).toHaveValue('Unsaved source title');
  await expect(page.getByRole('textbox', { name: '素材正文', exact: true })).toHaveText('Fresh content');
  state.sockets.at(-1)?.close({ code: 1013, reason: 'Backpressure test' });
  await expect.poll(() => state.sockets.length).toBe(2);
  await expect(title).toHaveValue('Unsaved source title');
  await expect.poll(() => state.context()?.sourceId).toBe('source-1');
  expect(state.writes).toEqual([]);
});

test('stage navigation retains separate drafts, undo and one active context without layout errors', async ({
  page,
}) => {
  const state = await studio(page);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/productions/production-test?step=brief');
  await page.getByLabel('节目标题', { exact: true }).fill('An unsaved brief title');
  const scriptTab = page.getByRole('tab', { name: '逐字稿', exact: true });
  const scriptPanel = page.getByRole('tabpanel', { name: '逐字稿', exact: true });
  await scriptTab.click();
  await expect(page).toHaveURL(/step=script$/);
  await expect(scriptTab).toHaveAttribute('aria-selected', 'true');
  await expect(scriptPanel).toBeVisible();
  await expect(scriptPanel).toHaveAttribute('data-state', 'active');
  await expect.poll(() => state.context()?.step).toBe('script');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await scriptPanel.getByRole('radio', { name: '编辑', exact: true }).click();
  const manuscript = scriptPanel.getByRole('textbox', { name: '完整逐字稿', exact: true });
  await manuscript.fill('Unsaved script from the first visit.');
  await expect.poll(() => state.context()?.draft?.value).toBe('Unsaved script from the first visit.');
  const oldContext = structuredClone(state.context() as PageContext);
  await page.getByRole('tab', { name: '选题', exact: true }).click();
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('An unsaved brief title');
  await expect.poll(() => state.context()?.step).toBe('brief');
  state.proposal(oldContext, 'hidden-script', 'Should not replace a hidden draft');
  await expect
    .poll(() =>
      state.frames.some(
        (frame) => frame.type === 'proposal.ack' && frame.id === 'hidden-script' && frame.status === 'stale',
      ),
    )
    .toBe(true);
  await page.getByRole('tab', { name: '成品制作', exact: true }).click();
  await page.getByRole('tab', { name: '发布文案', exact: true }).click();
  await page.getByLabel('节目摘要', { exact: true }).fill('Unsaved summary');
  await page.getByRole('tab', { name: '逐字稿', exact: true }).click();
  await expect(manuscript).toHaveText('Unsaved script from the first visit.');
  await expect(page.getByRole('button', { name: '保存逐字稿', exact: true })).toBeEnabled();
  await scriptPanel.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(manuscript).toHaveText('A saved manuscript.');
  await page.getByRole('tab', { name: '成品制作', exact: true }).click();
  await expect(page.getByLabel('节目摘要', { exact: true })).toHaveValue('Unsaved summary');
  await page.getByRole('tab', { name: '选题', exact: true }).click();
  await expect(page.getByLabel('节目标题', { exact: true })).toHaveValue('An unsaved brief title');
  await expect(page.locator('.studio-stage:visible')).toHaveCount(1);
  expect(state.sockets).toHaveLength(1);
  expect(state.writes).toEqual([]);
  expect(
    errors.filter((error) => /Reading the editor layout|scroll handler|Maximum update depth/.test(error)),
  ).toEqual([]);
});

test('untracked controls and asset subtabs clear the field but chat retains explicit focus', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  const title = page.getByLabel('节目标题', { exact: true });
  await title.fill('Keep this title draft');
  await expect.poll(() => state.context()?.field?.field).toBe('title');
  const original = structuredClone(state.context() as PageContext);
  await page.getByLabel('链接名称', { exact: true }).focus();
  await expect.poll(() => state.context()?.field).toBeNull();
  expect(state.context()?.draft).toBeNull();
  state.proposal(original, 'untracked-field', 'Do not overwrite');
  await expect
    .poll(() =>
      state.frames.some(
        (frame) =>
          frame.type === 'proposal.ack' && frame.id === 'untracked-field' && frame.status === 'stale',
      ),
    )
    .toBe(true);
  await title.focus();
  await expect.poll(() => state.context()?.field?.field).toBe('title');
  const focused = structuredClone(state.context() as PageContext);
  await page.getByRole('textbox', { name: '给主控的消息' }).fill('Use this explicit field');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => state.frames.some((frame) => frame.type === 'command')).toBe(true);
  const command = state.frames.find((frame) => frame.type === 'command');
  expect(command?.type === 'command' && command.context).toEqual(focused);
  await page.getByRole('tab', { name: '成品制作', exact: true }).click();
  await page.getByRole('tab', { name: '发布文案', exact: true }).click();
  const summary = page.getByLabel('节目摘要', { exact: true });
  await summary.fill('Keep this summary draft');
  await expect.poll(() => state.context()?.field?.field).toBe('summary');
  const copy = structuredClone(state.context() as PageContext);
  await page.getByRole('tab', { name: '封面', exact: true }).click();
  await expect.poll(() => state.context()?.field).toBeNull();
  state.proposal(copy, 'hidden-copy', 'Do not replace hidden copy');
  await expect
    .poll(() =>
      state.frames.some(
        (frame) => frame.type === 'proposal.ack' && frame.id === 'hidden-copy' && frame.status === 'stale',
      ),
    )
    .toBe(true);
  await page.getByRole('tab', { name: '发布文案', exact: true }).click();
  await expect(summary).toHaveValue('Keep this summary draft');
  expect(state.writes).toEqual([]);
});

test('source title selection changes invalidate old proposals and bind exact selected text', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief&source=source-1');
  const title = page.getByLabel('素材标题', { exact: true });
  await title.fill('Selected source title');
  await expect.poll(() => state.context()?.field?.field).toBe('source.title');
  const original = structuredClone(state.context() as PageContext);
  await title.press('ControlOrMeta+A');
  await expect.poll(() => state.context()?.selection?.text).toBe('Selected source title');
  expect(state.context()?.seq).toBeGreaterThan(original.seq);
  state.proposal(original, 'old-selection', 'Do not replace changed selection');
  await expect
    .poll(() =>
      state.frames.some(
        (frame) => frame.type === 'proposal.ack' && frame.id === 'old-selection' && frame.status === 'stale',
      ),
    )
    .toBe(true);
  await expect(title).toHaveValue('Selected source title');
  await page.getByRole('combobox', { name: '素材 1 类型' }).focus();
  await expect.poll(() => state.context()?.field).toBeNull();
  expect(state.writes).toEqual([]);
});

test('publication drafts survive stages and require confirmation before environment changes or refresh', async ({
  page,
}) => {
  const state = await studio(page, readyFixture());
  const remote: string[] = [];
  await page.route('**/admin/remote-api/**', async (route) => {
    remote.push(route.request().url());
    await route.abort();
  });
  await page.goto('/admin/productions/production-test?step=publish');
  const url = page.getByLabel('已发布的节目链接', { exact: true });
  await url.fill('https://example.com/unrecorded');
  await page.getByLabel('实际发布时间', { exact: true }).fill('2026-10-03T13:00');
  await page.getByRole('tab', { name: '选题，已完成', exact: true }).click();
  await page.getByRole('radio', { name: 'Prod', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('当前未保存的内容会丢弃');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '刷新内容', exact: true }).click();
  await expect(dialog).toContainText('所有阶段未保存的输入');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('tab', { name: '发布', exact: true }).click();
  await expect(url).toHaveValue('https://example.com/unrecorded');
  await expect(page.getByLabel('实际发布时间', { exact: true })).toHaveValue('2026-10-03T13:00');
  expect(state.writes).toEqual([]);
  expect(remote).toEqual([]);
});

test('chat follows initial history and new replies only while the reader stays at the bottom', async ({
  page,
}) => {
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  const log = page.getByRole('log', { name: '主控消息' });
  const composer = page.getByRole('textbox', { name: '给主控的消息' });
  const history = Array.from({ length: 35 }, (_, index) => ({
    id: `history-${index}`,
    role: 'assistant' as const,
    text: `Reply ${index}\n\n${'A longer paragraph to make the chat overflow. '.repeat(5)}`,
    commandId: null,
    createdAt: '2026-10-03T00:00:00Z',
  }));
  await expect(log).toBeVisible();
  const shellScroll = await page.locator('.admin-shell').evaluate((element) => element.scrollTop);
  state.send({
    type: 'snapshot',
    online: true,
    messages: history,
    conversations: [],
    commands: [],
    proposals: [],
  });
  const bottomGap = () =>
    log.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  await expect(log.locator('.agent-message')).toHaveCount(35);
  await expect.poll(bottomGap).toBeLessThanOrEqual(2);
  await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(composer).toBeInViewport();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
  state.send({
    type: 'message',
    message: { ...history[0], id: 'new-at-bottom', text: 'Follow this new reply at the bottom.' },
  });
  await expect(log).toContainText('Follow this new reply at the bottom.');
  await expect.poll(bottomGap).toBeLessThanOrEqual(2);
  await log.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBe(0);
  state.send({
    type: 'message',
    message: { ...history[0], id: 'while-reading', text: 'Do not interrupt reading earlier replies.' },
  });
  await expect(log).toContainText('Do not interrupt reading earlier replies.');
  await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBe(0);
  await expect.poll(bottomGap).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: '最新消息' })).toBeVisible();
  await expect(composer).toBeInViewport();
  await page.getByRole('button', { name: '最新消息' }).click();
  await expect(page.getByRole('button', { name: '最新消息' })).toHaveCount(0);
  await expect.poll(bottomGap).toBeLessThanOrEqual(2);
  state.send({
    type: 'message',
    message: {
      ...history[0],
      id: 'resume-following',
      text: 'Following resumes after returning to the bottom.',
    },
  });
  await expect(log).toContainText('Following resumes after returning to the bottom.');
  await expect.poll(bottomGap).toBeLessThanOrEqual(2);
  expect(await page.locator('.admin-shell').evaluate((element) => element.scrollTop)).toBe(shellScroll);
  expect(state.writes).toEqual([]);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`composer grows upward from three to five lines at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const state = await studio(page);
    await page.goto('/admin/productions/production-test?step=brief');
    const composer = page.getByRole('textbox', { name: '给主控的消息' });
    await expect(composer).toBeVisible();
    const measure = () =>
      composer.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          height: bounds.height,
          lineHeight: Number.parseFloat(style.lineHeight),
          inset:
            Number.parseFloat(style.paddingTop) +
            Number.parseFloat(style.paddingBottom) +
            Number.parseFloat(style.borderTopWidth) +
            Number.parseFloat(style.borderBottomWidth),
          overflow: element.scrollHeight - element.clientHeight,
        };
      });
    const initial = await measure();
    expect(initial.height).toBeCloseTo(3 * initial.lineHeight + initial.inset, 0);
    for (const lines of [3, 4, 5, 6, 8]) {
      await composer.fill(Array.from({ length: lines }, (_, index) => `Line ${index + 1}`).join('\n'));
      const current = await measure();
      expect(current.height).toBeCloseTo(Math.min(lines, 5) * initial.lineHeight + initial.inset, 0);
      expect(current.bottom).toBeCloseTo(initial.bottom, 0);
      expect(current.top).toBeCloseTo(initial.bottom - current.height, 0);
      if (lines <= 5) expect(current.overflow).toBeLessThanOrEqual(1);
      else expect(current.overflow).toBeGreaterThan(initial.lineHeight / 2);
    }
    await composer.evaluate((element) => {
      element.scrollTop = 0;
    });
    await composer.hover();
    await page.mouse.wheel(0, 160);
    await expect.poll(() => composer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    expect(await page.locator('.admin-shell').evaluate((element) => element.scrollTop)).toBe(0);
    await composer.fill('Short draft');
    expect((await measure()).height).toBeCloseTo(initial.height, 0);
    await composer.fill('A long wrapped draft without explicit newlines. '.repeat(20));
    expect((await measure()).height).toBeCloseTo(5 * initial.lineHeight + initial.inset, 0);
    expect((await measure()).overflow).toBeGreaterThan(0);
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    expect((await measure()).height).toBeCloseTo(initial.height, 0);
    await expect.poll(() => state.frames.filter((frame) => frame.type === 'command').length).toBe(1);
    expect(state.writes).toEqual([]);
  });
}

test('chat presents grouped messages, copies text, and sends only deliberate input', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  const sidebar = page.getByRole('complementary', { name: '主控对话' });
  const composer = page.getByRole('textbox', { name: '给主控的消息' });
  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(380);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await sidebar.getByRole('button', { name: /帮我梳理这一期的思路/ }).click();
  await expect(composer).toHaveValue('帮我梳理这一期的思路');
  await expect(composer).toBeFocused();
  await composer.fill('First line');
  await composer.press('Shift+Enter');
  await expect(composer).toHaveValue('First line\n');
  await composer.fill('A question');
  await composer.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(state.frames.filter((frame) => frame.type === 'command')).toHaveLength(0);
  await expect(composer).toHaveValue('A question');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect.poll(() => state.frames.filter((frame) => frame.type === 'command').length).toBe(1);
  await expect(sidebar.locator('.agent-message-user')).toHaveCount(1);
  await expect(sidebar.locator('.agent-message-user .agent-message-body')).toHaveText('A question');
  await composer.fill('A question');
  await sidebar.getByRole('button', { name: '发送', exact: true }).click();
  await expect(composer).toHaveValue('');
  await expect.poll(() => state.frames.filter((frame) => frame.type === 'command').length).toBe(2);
  await expect(sidebar.locator('.agent-message-user')).toHaveCount(2);
  state.send({
    type: 'message',
    message: {
      id: 'reply-one',
      role: 'assistant',
      text: '**A helpful reply**',
      commandId: null,
      createdAt: '2026-10-03T08:12:00Z',
    },
  });
  state.send({
    type: 'message',
    message: {
      id: 'reply-two',
      role: 'assistant',
      text: 'Second reply',
      commandId: null,
      createdAt: '2026-10-03T08:13:00Z',
    },
  });
  await expect(sidebar.locator('.agent-message-assistant')).toHaveCount(2);
  await expect(sidebar.locator('.agent-message-assistant .agent-message-identity')).toHaveCount(1);
  await expect(
    sidebar.locator('.agent-message-assistant').first().locator('.agent-message-body strong'),
  ).toContainText('A helpful reply');
  const reply = sidebar.locator('.agent-message-assistant').first();
  const copyButton = reply.locator('.agent-message-copy');
  await composer.hover();
  await expect(copyButton).toHaveCSS('opacity', '0');
  await expect(copyButton).toHaveText('');
  await reply.hover();
  await expect(copyButton).toHaveCSS('opacity', '1');
  const bodyBounds = await reply.locator('.agent-message-body').boundingBox();
  const copyBounds = await copyButton.boundingBox();
  if (!bodyBounds || !copyBounds) throw new Error('Expected message and copy button bounds');
  expect(copyBounds.x).toBeGreaterThanOrEqual(bodyBounds.x + bodyBounds.width);
  expect(copyBounds.y).toBe(bodyBounds.y);
  await composer.hover();
  await expect(copyButton).toHaveCSS('opacity', '0');
  await copyButton.focus();
  await expect(copyButton).toHaveCSS('opacity', '1');
  await copyButton.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('**A helpful reply**');
  await expect(copyButton).toHaveAccessibleName('已复制主控的消息');
  await expect(copyButton).toHaveText('');
  await composer.focus();
  await expect(copyButton).toHaveCSS('opacity', '0');
  await composer.fill('');
  await expect(sidebar.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  const command = state.frames.find((frame) => frame.type === 'command');
  if (command?.type !== 'command') throw new Error('Expected a sent command');
  state.send({
    type: 'command.state',
    id: 'working-event',
    commandId: command.id,
    status: 'working',
    detail: 'Checking the manuscript',
  });
  const workingTask = sidebar.locator('.agent-task').filter({ hasText: 'Checking the manuscript' });
  await expect(workingTask).toContainText('正在处理');
  await expect(workingTask.locator('.agent-task-pulse')).toHaveAttribute('data-status', 'working');
  expect(state.writes).toEqual([]);
});

test.describe('touch chat actions', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, colorScheme: 'dark' });

  test('keeps icon-only copying reachable without hover', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = await studio(page);
    await page.goto('/admin/productions/production-test?step=brief');
    const composer = page.getByRole('textbox', { name: '给主控的消息' });
    await composer.fill('Touch message');
    await page.getByRole('button', { name: '发送', exact: true }).tap();
    const message = page.locator('.agent-message-user');
    await expect(message).toHaveCount(1);
    const copy = message.locator('.agent-message-copy');
    await expect(copy).toHaveCSS('opacity', '1');
    await expect(copy).toHaveText('');
    const bodyBounds = await message.locator('.agent-message-body').boundingBox();
    const copyBounds = await copy.boundingBox();
    if (!bodyBounds || !copyBounds) throw new Error('Expected touch message and copy bounds');
    expect(copyBounds.x + copyBounds.width).toBeLessThanOrEqual(bodyBounds.x);
    expect(copyBounds.y).toBe(bodyBounds.y);
    await copy.tap();
    await expect(copy).toHaveAccessibleName('已复制你的消息');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Touch message');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(state.writes).toEqual([]);
  });
});

test('chat remains usable on narrow screens and in dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const state = await studio(page);
  await page.goto('/admin/productions/production-test?step=brief');
  await expect(page.locator('html')).toHaveClass(/dark/);
  const sidebar = page.getByRole('complementary', { name: '主控对话' });
  await expect(sidebar).toBeInViewport();
  await expect(sidebar.getByRole('textbox', { name: '给主控的消息' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await sidebar.getByRole('textbox', { name: '给主控的消息' }).fill('Narrow screen');
  await sidebar.getByRole('button', { name: '发送', exact: true }).click();
  await expect
    .poll(() => state.frames.some((frame) => frame.type === 'command' && frame.text === 'Narrow screen'))
    .toBe(true);
  expect(state.writes).toEqual([]);
});
