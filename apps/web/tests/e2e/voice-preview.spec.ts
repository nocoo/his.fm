import { expect, type Page, test } from '@playwright/test';

async function openPreview(page: Page) {
  await page.route('**/admin/api/session', (route) =>
    route.fulfill({ json: { mode: 'local', user: { email: 'voice-test@example.invalid' } } }),
  );
  await page.route('https://f.no.mt/reference/voices/**', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag',
        ETag: '"voice-test"',
      },
    }),
  );
  await page.goto('/admin/voice-preview');
  await expect(page.locator('.appearance-voice-card')).toHaveCount(55);
  await expect(page.locator('.appearance-voice-card audio')).toHaveCount(55);
}

async function selectFilter(page: Page, label: string, option: RegExp) {
  const dropdown = page.getByRole('combobox', { name: label });
  if (await dropdown.isVisible()) {
    await dropdown.click();
    await page.getByRole('option', { name: option }).click();
  } else {
    await page.getByRole('radiogroup', { name: label }).getByRole('radio', { name: option }).click();
  }
}

test('voice filters survive responsive controls and preserve exact model metadata', async ({ page }) => {
  await openPreview(page);
  const cards = page.locator('.appearance-voice-card');
  await expect(page.getByText('准备好，慢慢听', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-provider="gemini"] .voice-model-label')).toHaveText(
    Array(30).fill('3.8 Flash TTS'),
  );
  await expect(page.locator('#voice-fixed-script')).toBeHidden();
  await page.getByRole('button', { name: '固定文稿', exact: true }).click();
  await expect(page.locator('#voice-fixed-script')).toContainText('hi@his.fm');
  await page.getByRole('button', { name: '固定文稿', exact: true }).click();
  await selectFilter(page, '按厂商筛选', /^MAI Voice/);
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.voice-model-label')).toHaveText(Array(5).fill('MAI-Voice-2.1'));
  await selectFilter(page, '按性别筛选', /^女声/);
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.voice-sample-name')).toHaveText(['Harper', 'Lan', 'Mei']);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: '按厂商筛选' })).toContainText('MAI Voice');
  await expect(page.getByRole('combobox', { name: '按性别筛选' })).toContainText('女声');
  await selectFilter(page, '按性别筛选', /^男声/);
  await expect(cards.locator('.voice-sample-name')).toHaveText(['Bo', 'Grant']);
  await page.getByRole('switch', { name: '显示技术信息' }).click();
  await expect(cards.first()).toContainText('zh-CN-Bo:MAI-Voice-2.1');
  await expect(cards.first()).toContainText('reference/voices/mai-2.1-zh-CN-Bo.mp3');
  await expect(cards.first().locator('audio')).toHaveAttribute('src', /Bo\.mp3\?v=voice-test$/);
  await page.getByRole('textbox', { name: '搜索音色' }).fill('not-a-voice');
  await expect(page.getByText('没有匹配的音色')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(cards).toHaveCount(55);
  await selectFilter(page, '按性别筛选', /^非二元/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute('data-voice', 'River');
});

for (const width of [1440, 390, 320]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`voice cards stay compact at ${width}px in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme });
      await openPreview(page);
      const metrics = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.appearance-voice-card')];
        const canvas = document.createElement('canvas').getContext('2d');
        if (!canvas) throw new Error('Canvas color sampling is unavailable');
        const rgb = (color: string) => {
          canvas.clearRect(0, 0, 1, 1);
          canvas.fillStyle = color;
          canvas.fillRect(0, 0, 1, 1);
          return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const luminance = (color: string) =>
          rgb(color).reduce((sum, value, index) => {
            const channel = value / 255;
            const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            return sum + linear * [0.2126, 0.7152, 0.0722][index];
          }, 0);
        const tags = [...document.querySelectorAll('.voice-tag')].map((tag) => {
          const { color, backgroundColor } = getComputedStyle(tag);
          return {
            white: rgb(color).every((channel) => channel === 255),
            contrast: (luminance(color) + 0.05) / (luminance(backgroundColor) + 0.05),
          };
        });
        const filters = [...document.querySelectorAll('[aria-label="按厂商筛选"], [aria-label="按性别筛选"]')]
          .filter((element) => element.getBoundingClientRect().height > 0)
          .map((element) => element.getBoundingClientRect());
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          clippedCards: cards.filter((card) => card.scrollWidth > card.clientWidth).length,
          maxHeight: Math.max(...cards.map((card) => card.getBoundingClientRect().height)),
          filterTops: filters.map((filter) => filter.top),
          minimumTagContrast: Math.min(...tags.map((tag) => tag.contrast)),
          whiteTags: tags.every((tag) => tag.white),
          buttonSizes: cards.flatMap((card) =>
            [...card.querySelectorAll('.his-audio-play, .his-audio-tool')].map((button) => {
              const rect = button.getBoundingClientRect();
              return Math.min(rect.width, rect.height);
            }),
          ),
        };
      });
      expect(metrics.overflow).toBe(false);
      expect(metrics.clippedCards).toBe(0);
      expect(metrics.whiteTags).toBe(true);
      expect(metrics.minimumTagContrast).toBeGreaterThanOrEqual(4.5);
      expect(metrics.maxHeight).toBeLessThanOrEqual(200);
      expect(metrics.filterTops).toHaveLength(2);
      expect(Math.abs(metrics.filterTops[0] - metrics.filterTops[1])).toBeLessThan(1);
      expect(metrics.buttonSizes.every((size) => size >= 44)).toBe(true);
      await expect(page.getByRole('slider', { name: '音量（百分比）' })).toHaveCount(0);
    });
  }
}
