import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const root = new URL('.', import.meta.url);
const receipt = JSON.parse(await readFile(new URL('delivery.json', root), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(new URL('system.architecture.json', root));
const artifact = await readFile(new URL('index.html', root));
assert.equal(digest(source), receipt.specification.sha256);
assert.equal(digest(artifact), receipt.artifact.sha256);
assert.equal(receipt.validation.checksPassed, 9);
assert.equal(receipt.validation.errors, 0);
assert.equal(receipt.validation.warnings, 0);
const spec = JSON.parse(source);
assert.equal(spec.components.length, 12);
assert.equal(spec.boundaries.length, 3);
assert.equal(spec.meta.locale, 'zh-CN');
assert.deepEqual(
  spec.meta.views.map(({ id }) => id),
  ['workspace', 'realtime', 'conversations', 'delivery', 'trust'],
);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(`${new URL('index.html', root).href}?theme=light`);
  assert.match(await page.title(), /his.fm/);
  assert.equal(await page.locator('svg[data-quality-profile="showcase"]').count(), 1);
  for (const view of spec.meta.views) {
    await page
      .getByRole('button', { name: new RegExp(view.label) })
      .first()
      .click();
    assert.match(page.url(), new RegExp(`view=${view.id}`));
  }
  await page.goto(`${new URL('index.html', root).href}?theme=light`);
  await page.locator('[data-node-id="controller"]').first().click();
  assert.equal(
    await page.locator('[data-node-id="controller"]').first().getAttribute('data-focus-selected'),
    '',
  );
  await page.keyboard.press('Escape');
  for (const [width, height] of [
    [1440, 900],
    [1600, 1000],
    [1920, 1080],
    [2048, 1320],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(120);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
      true,
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log(
    'Archify artifact hashes, 9 showcase gates, 5 views, node focus, desktop containment and offline behavior verified.',
  );
} finally {
  await browser.close();
}
