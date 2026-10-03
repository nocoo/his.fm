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
      if (frame.type === 'command') socket.send(JSON.stringify({ type: 'command.ack', id: frame.id }));
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
