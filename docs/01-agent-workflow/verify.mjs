import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = join(repo, '.local/agent-architecture');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const errors = [];
  const network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(pathToFileURL(join(directory, 'index.html')).href);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#tab-journey').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#save-edits').isDisabled(), true);
  await page.screenshot({ path: join(output, 'studio-desktop.png'), fullPage: true });
  await page.locator('#ask-source').click();
  assert.equal(await page.locator('#source-list li').count(), 2);
  assert.match(await page.locator('#chat').textContent(), /左侧列表已经更新/);
  await page.locator('#source-list button').nth(1).click();
  const source = page.getByLabel('原始素材正文', { exact: true });
  await source.fill('# 我的资料稿\n保留我的观察。');
  await page.locator('#simulate-update').click();
  assert.equal(await source.inputValue(), '# 我的资料稿\n保留我的观察。');
  assert.equal(await page.locator('#conflict-region').isVisible(), true);
  assert.equal(await page.locator('#save-edits').isDisabled(), true);
  await page.screenshot({ path: join(output, 'studio-conflict.png'), fullPage: true });
  await page.getByRole('button', { name: '保留我的草稿，随后 Save' }).click();
  await page.locator('#save-edits').click();
  assert.equal(await source.inputValue(), '# 我的资料稿\n保留我的观察。');
  assert.equal(await page.locator('#save-edits').isDisabled(), true);
  await page.getByRole('button', { name: '返回选题与素材列表' }).click();
  const title = page.getByLabel('节目标题', { exact: true });
  await title.fill('我的节目标题');
  await page.getByLabel('创作意图', { exact: true }).focus();
  await page.locator('#ask-improve').click();
  assert.equal(await title.inputValue(), '我的节目标题');
  assert.match(await page.getByLabel('创作意图', { exact: true }).inputValue(), /晚饭已凉/);
  assert.equal(await page.locator('#conflict-region').isVisible(), false);
  await page.locator('#owner-message').fill('还没有发出的消息');
  await page.locator('[data-stage="1"]').click();
  await page.getByLabel('完整逐字稿', { exact: true }).fill('# 未保存的逐字稿');
  await page.locator('[data-stage="0"]').click();
  assert.equal(await title.inputValue(), '我的节目标题');
  assert.equal(await page.locator('#owner-message').inputValue(), '还没有发出的消息');
  await page.locator('#save-edits').click();
  await page.locator('[data-stage="1"]').click();
  assert.equal(await page.getByLabel('完整逐字稿', { exact: true }).inputValue(), '# 未保存的逐字稿');
  await page.locator('[data-stage="0"]').click();
  await page.getByLabel('创作意图', { exact: true }).fill('本地未保存的意图');
  await page.locator('#ask-improve').click();
  assert.equal(await page.locator('#draft-context-warning').isVisible(), true);
  await page.getByRole('button', { name: '仅基于已保存版本发送' }).click();
  assert.equal(await page.getByLabel('创作意图', { exact: true }).inputValue(), '本地未保存的意图');
  await page.getByRole('button', { name: '采用主控已保存版本' }).click();
  assert.match(await page.getByLabel('创作意图', { exact: true }).inputValue(), /晚饭已凉/);
  await title.fill('遇到并发也保留的标题');
  await page.locator('#simulate-race').click();
  await page.locator('#save-edits').click();
  assert.match(await page.locator('#update-notice').textContent(), /409/);
  assert.equal(await title.inputValue(), '遇到并发也保留的标题');
  await page.getByRole('button', { name: '保留我的草稿，随后 Save' }).click();
  await page.locator('#save-edits').click();
  await page.locator('#toggle-connection').click();
  await title.fill('主控离线也能修改');
  await page.locator('#save-edits').click();
  assert.match(await page.locator('#save-state').textContent(), /你已保存/);
  await page.locator('#ask-source').click();
  assert.match(await page.locator('#chat').textContent(), /队列中等待/);
  await page.locator('#toggle-connection').click();
  assert.equal(await page.locator('#source-list li').count(), 3);
  await page.locator('#owner-message').fill('<img src=x onerror=alert(1)> 请用生活场景');
  await page.getByRole('button', { name: '发送给主控', exact: true }).click();
  assert.equal(await page.locator('#chat img').count(), 0);
  assert.doesNotMatch(await page.locator('.studio-demo').innerText(), /Jev|thinking|profile|概率/);
  await page.locator('#reset-studio').click();
  await page.locator('#source-list button').first().click();
  assert.match(await page.locator('#chat-context').textContent(), /素材 s1/);
  const contextField = page.getByLabel('原始素材正文', { exact: true });
  await contextField.fill('第一段保留。第二段请修改。第三段不动。');
  assert.match(await page.locator('#context-version').textContent(), /未保存草稿/);
  await contextField.evaluate((input) => {
    input.setSelectionRange(6, 13);
    input.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.locator('#owner-message').fill('还没有发送的私有聊天输入');
  assert.match(await page.locator('#context-selection').textContent(), /第二段请修改/);
  assert.doesNotMatch(await page.locator('.assistant-context').textContent(), /私有聊天输入/);
  await page.locator('#ask-context').click();
  assert.match(await page.locator('#chat').textContent(), /选中的是/);
  const savedBefore = await page.locator('#canonical-version').textContent();
  await page.locator('#ask-improve').click();
  await page.getByRole('button', { name: '按当前草稿修改，不保存', exact: true }).click();
  const adjusted = await contextField.inputValue();
  assert.match(adjusted, /示例润色/);
  assert.equal(adjusted.startsWith('第一段保留。'), true);
  assert.equal(adjusted.endsWith('第三段不动。'), true);
  assert.equal(await page.locator('#canonical-version').textContent(), savedBefore);
  assert.equal(await page.locator('#save-edits').isDisabled(), false);
  await page.screenshot({ path: join(output, 'page-context-desktop.png'), fullPage: true });

  await page.locator('#simulate-delay').click();
  await page.locator('#ask-improve').click();
  await page.getByRole('button', { name: '按当前草稿修改，不保存', exact: true }).click();
  await contextField.fill('回复到达之前，用户继续输入。');
  await page.locator('#release-reply').click();
  assert.equal(await contextField.inputValue(), '回复到达之前，用户继续输入。');
  assert.match(await page.locator('#chat').textContent(), /草稿建议暂未应用/);

  await page.locator('#simulate-delay').click();
  await page.locator('#ask-improve').click();
  await page.getByRole('button', { name: '按当前草稿修改，不保存', exact: true }).click();
  await page.locator('#toggle-context').click();
  await page.locator('#toggle-context').click();
  await page.locator('#release-reply').click();
  assert.equal(await contextField.inputValue(), '回复到达之前，用户继续输入。');

  await page.locator('#simulate-delay').click();
  await page.locator('#ask-improve').click();
  await page.getByRole('button', { name: '按当前草稿修改，不保存', exact: true }).click();
  await page.locator('[data-stage="1"]').click();
  const scriptBefore = await page.getByLabel('完整逐字稿', { exact: true }).inputValue();
  await page.locator('#release-reply').click();
  assert.equal(await page.getByLabel('完整逐字稿', { exact: true }).inputValue(), scriptBefore);
  assert.match(await page.locator('#chat').textContent(), /没有改到你后来打开的页面/);

  await page.locator('#toggle-context').click();
  await page.getByLabel('完整逐字稿', { exact: true }).fill('暂停共享之后的新草稿');
  assert.match(await page.locator('#chat-context').textContent(), /共享已暂停/);
  const pausedMessages = await page.locator('#chat .chat-bubble').count();
  await page.locator('#ask-context').click();
  assert.equal(await page.locator('#chat .chat-bubble').count(), pausedMessages);
  await page.locator('#toggle-context').click();
  await page.locator('#simulate-context-stale').click();
  await page.locator('#ask-context').click();
  assert.match(await page.locator('#update-notice').textContent(), /尚未确认同步/);
  await page.locator('#simulate-context-stale').click();
  await page.getByLabel('完整逐字稿', { exact: true }).dispatchEvent('compositionstart');
  await page.locator('#ask-context').click();
  assert.match(await page.locator('#context-version').textContent(), /中文输入尚未完成/);
  await page.getByLabel('完整逐字稿', { exact: true }).dispatchEvent('compositionend');
  await page.locator('#ask-context').click();
  assert.match(await page.locator('#chat').textContent(), /完整逐字稿/);

  await page.locator('#reset-studio').click();
  await page.locator('#approve-stage').click();
  await page.locator('[data-stage="1"]').click();
  await page.locator('#ask-improve').click();
  await page.locator('#approve-stage').click();
  await page.locator('[data-stage="2"]').click();
  await page.getByRole('button', { name: '制作音频（模拟）', exact: true }).click();
  await page.getByRole('button', { name: '确认已有封面（模拟）', exact: true }).click();
  await page.locator('#approve-stage').click();
  await page.locator('#approve-stage').click();
  assert.match(await page.locator('#approval-status').textContent(), /成品 已确认/);
  await page.locator('#tab-system').click();
  await page.locator('[data-node="cli"]').click();
  assert.match(await page.locator('#node-not').textContent(), /逻辑职责而非强隔离/);
  await page.locator('[data-node="controller"]').click();
  await page.screenshot({ path: join(output, 'system-desktop.png'), fullPage: true });

  await page.getByRole('tab', { name: '03 中断之后' }).click();
  for (const name of [
    '网站断线',
    '主控进程崩溃',
    '写回遇到 409',
    '音频响应丢失',
    'Jev 不可用',
    'Token 撤销 / 接管',
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    for (let step = 0; step < 4; step++) await page.locator('#recover').click();
    assert.equal(await page.locator('#recover').isDisabled(), true);
    assert.equal(await page.locator('.recovery-steps .passed').count(), 4);
  }

  await page.getByRole('tab', { name: '04 技术附录 / Review' }).click();
  await page.locator('#assignment-kind').selectOption('offline');
  assert.equal(await page.locator('#decision-choice').textContent(), 'waiting_decision');
  await page.locator('#review-R1').selectOption('discuss');
  await page.locator('#review-notes').fill('先确认本机信任边界。');
  await page.reload();
  assert.equal(await page.locator('#review-R1').inputValue(), 'discuss');
  assert.equal(await page.locator('#review-notes').inputValue(), '先确认本机信任边界。');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-review').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'hisfm-agent-architecture-review.md');
  const content = await readFile(await download.path(), 'utf8');
  assert.match(content, /立场：先讨论/);
  assert.match(content, /先确认本机信任边界/);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#clear-review').click();
  assert.equal(await page.locator('#review-R1').inputValue(), 'pending');
  await page.reload();
  assert.equal(await page.locator('#review-notes').inputValue(), '');

  await page.getByRole('tab', { name: '01 工作室协同' }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-system').getAttribute('aria-selected'), 'true');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const id of ['system', 'journey', 'recovery', 'decisions']) {
      await page.locator(`#tab-${id}`).click();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `${id} at ${width}px`,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#tab-journey').click();
  await page.screenshot({ path: join(output, 'studio-phone.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log(
    'Architecture walkthrough passed: split workspace, source edits, Save, dirty field conflicts, 409, offline queue, page context/selection, draft-only edits, frozen command targets, stale/paused/IME barriers, no decision chatter, 6 failures, review persistence/export, keyboard, 320/390px, no network or page errors.',
  );
} finally {
  await browser.close();
}
