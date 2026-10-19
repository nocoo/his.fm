import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { themeFaviconSrc, themes } from '../../src/brand/themes';
import { type Appearance, themeIds } from '../../src/shared/appearance';
import { coverArtwork, coverDesignSize } from '../../src/shared/cover-composition';

test('all eight previews load real artwork, inline identity and same-origin fonts on desktop and phone', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const writes: string[] = [];
  const fonts: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/appearance')) writes.push(request.url());
    if (request.resourceType() === 'font') fonts.push(request.url());
  });
  await mkdir('.local/appearance', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const id of themeIds) {
      await page.goto(`/?theme=${id}`);
      await expect(page.locator('.public-site')).toHaveAttribute('data-theme', id);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(themes[id].heading.join(''));
      await expect(page.locator('.site-header .brand-wordmark path')).toHaveCount(1);
      await expect(page.locator('.footer-wordmark .brand-wordmark path')).toHaveCount(1);
      await expect(page.locator('.brand-wordmark use')).toHaveCount(0);
      await expect
        .poll(() =>
          page.locator('.hero-visual img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      await page.evaluate(() => document.fonts.ready);
      const covers = page.locator('.episode-card .framed-cover');
      expect(await covers.count()).toBeGreaterThan(0);
      for (const cover of await covers.all()) {
        await expect(cover).toHaveAttribute('data-cover-theme', id);
        await expect(cover.locator('.framed-cover-image')).toHaveCSS('object-fit', 'cover');
        await expect(cover.locator('.framed-cover-image')).toHaveCSS('object-position', '50% 50%');
        await expect(cover.locator('.framed-cover-copy text')).not.toHaveCount(0);
        const geometry = await cover.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const image = element.querySelector('img')?.getBoundingClientRect();
          if (!image) throw new Error('Missing clean artwork');
          return {
            x: (image.x - rect.x) / rect.width,
            y: (image.y - rect.y) / rect.height,
            width: image.width / rect.width,
            height: image.height / rect.height,
            overflow: [...element.querySelectorAll('text')].some((text) => {
              const bounds = text.getBBox();
              return (
                bounds.x < 0 ||
                bounds.y < 0 ||
                bounds.x + bounds.width > 1024 ||
                bounds.y + bounds.height > 1024
              );
            }),
          };
        });
        const artwork = coverArtwork(id);
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(geometry[key]).toBeCloseTo(artwork[key] / coverDesignSize, 3);
        expect(geometry.overflow).toBe(false);
        if (id === 'window-seat') {
          const padding = await cover.evaluate((element) => {
            const canvas = document.createElement('canvas').getContext('2d');
            if (!canvas) throw new Error('Missing text measurement context');
            const titles = [...element.querySelectorAll('text')].filter(
              (text) => Number(text.getAttribute('font-size')) > 30,
            );
            const ink = titles.map((text) => {
              const style = getComputedStyle(text);
              canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
              const metrics = canvas.measureText(text.textContent ?? '');
              const baseline = Number(text.getAttribute('y'));
              return {
                top: baseline - metrics.actualBoundingBoxAscent,
                bottom: baseline + metrics.actualBoundingBoxDescent,
              };
            });
            return {
              top: Math.min(...ink.map((line) => line.top)) - 808,
              bottom: 993 - Math.max(...ink.map((line) => line.bottom)),
            };
          });
          expect(padding.top).toBeGreaterThan(20);
          expect(padding.bottom).toBeGreaterThan(20);
          expect(Math.abs(padding.top - padding.bottom)).toBeLessThan(8);
        }
      }
      const card = page.locator('.episode-card').first();
      await card.hover();
      const arrow = card.locator('.art-arrow');
      await expect(arrow).toHaveCSS('opacity', '1');
      await expect(arrow).toHaveCSS('color', 'rgb(255, 255, 255)');
      const action = await arrow.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const art = element.closest('.episode-art')?.getBoundingClientRect();
        if (!art) throw new Error('Missing cover link');
        return {
          background: getComputedStyle(element).backgroundColor,
          primary: getComputedStyle(element.closest('.public-site') as Element).color,
          bottom: (art.bottom - rect.bottom) / art.height,
          right: (art.right - rect.right) / art.width,
        };
      });
      expect(action.background).toBe(action.primary);
      expect(action.bottom).toBeCloseTo(0.06, 2);
      expect(action.right).toBeCloseTo(0.06, 2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${id} at ${width}px`,
      ).toBe(true);
      await page.screenshot({ path: `.local/appearance/${id}-${width}.png`, animations: 'disabled' });
    }
  }
  const family = await page.evaluate(async () => ({
    latin: (await document.fonts.load('500 24px "Space Grotesk"', 'his.fm')).length,
    chinese: (await document.fonts.load('500 24px "Noto Sans SC"', '间隙山林')).length,
  }));
  expect(family.latin).toBeGreaterThan(0);
  expect(family.chinese).toBeGreaterThan(0);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await page.getByRole('link', { name: '找一期，歇一会儿' }).click();
  await expect(page).toHaveURL(/\/episodes\?theme=alpine-bloom$/);
  await page.getByRole('link', { name: '退出预览' }).click();
  await expect(page).toHaveURL(/\/episodes$/);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('long Chinese and wide Latin cover titles stay inside every theme and clear the hover action', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const titles = [
    '我们在一个不断变化的世界里，如何重新找回属于自己的时间和生活',
    '从 WWDC 到 MWC：我们为什么总在期待下一个改变世界的产品',
    'WWDC MWC WWW Windows Windows Windows Windows',
  ];
  await page.route('**/api/episodes', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: {
        ...data,
        episodes: data.episodes.slice(0, titles.length).map((episode: object, index: number) => ({
          ...episode,
          title: titles[index],
        })),
      },
    });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of themeIds) {
      await page.goto(`/episodes?theme=${theme}`);
      await expect(page.locator('.episode-card h3').first()).toHaveText(titles[0]);
      await page.evaluate(() => document.fonts.ready);
      for (const art of await page.locator('.episode-art').all()) {
        await art.hover();
        const bounds = await art.evaluate((element) => {
          const arrow = element.querySelector('.art-arrow')?.getBoundingClientRect();
          const cover = element.querySelector('.framed-cover')?.getBoundingClientRect();
          if (!arrow || !cover) throw new Error('Missing cover action');
          return {
            height: cover.height,
            linkHeight: element.getBoundingClientRect().height,
            actionTop: arrow.top - cover.top,
            actionBottom: cover.bottom - arrow.bottom,
            lines: [...element.querySelectorAll('.framed-cover-copy text')]
              .filter((text) => Number(text.getAttribute('font-size')) > 30)
              .map((text) => {
                const glyphs = (text as SVGTextElement).getBBox();
                return {
                  designRight: glyphs.x + glyphs.width,
                  gap: arrow.left - text.getBoundingClientRect().right,
                };
              }),
          };
        });
        expect(bounds.linkHeight, `${theme} at ${width}px`).toBeCloseTo(bounds.height, 1);
        expect(bounds.actionTop, `${theme} at ${width}px`).toBeGreaterThan(0);
        expect(bounds.actionBottom / bounds.height, `${theme} at ${width}px`).toBeCloseTo(0.06, 2);
        for (const line of bounds.lines) {
          expect(line.designRight, `${theme} at ${width}px`).toBeLessThanOrEqual(844);
          expect(line.gap, `${theme} at ${width}px`).toBeGreaterThan(1);
        }
      }
    }
  }
});

test('the owner can preview and apply a theme without changing production or concurrent local edits', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '进入本地工作室' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await page.getByRole('button', { name: '品牌外观', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: '网站视觉主题' })).toBeVisible();
  const before = await page.evaluate(
    async () =>
      ((await (await fetch('/admin/api/appearance')).json()) as { appearance: Appearance }).appearance,
  );
  const selected = before.theme === 'stillwood' ? 'interval' : 'stillwood';
  let written: Appearance | undefined;
  const publicPage = await context.newPage();
  try {
    await page
      .getByRole('radio', { name: `${themes[selected].number} · ${themes[selected].name}`, exact: true })
      .click();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: '预览所选风格' }).click();
    const preview = await popupPromise;
    await expect(preview.locator('.public-site')).toHaveAttribute('data-theme', selected);
    await expect(preview.getByLabel('外观预览')).toBeVisible();
    await preview.close();
    expect(
      await page.evaluate(
        async () =>
          ((await (await fetch('/admin/api/appearance')).json()) as { appearance: Appearance }).appearance,
      ),
    ).toEqual(before);
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/admin/api/appearance' && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '应用到公开网站' }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    written = (await response.json()).appearance;
    await expect(page.getByRole('button', { name: '应用到公开网站' })).toBeDisabled();
    await publicPage.goto('/');
    await expect(publicPage.locator('.public-site')).toHaveAttribute('data-theme', selected);
    expect(await publicPage.evaluate(async () => await (await fetch('/api/appearance')).json())).toEqual({
      appearance: { theme: selected },
    });
  } finally {
    if (written) {
      const restored = await page.evaluate(
        async ({ before, written }) => {
          const current = (
            (await (await fetch('/admin/api/appearance')).json()) as { appearance: Appearance }
          ).appearance;
          if (current.version !== written.version || current.theme !== written.theme)
            return 'concurrent-edit';
          const response = await fetch('/admin/api/appearance', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: before.theme, version: written.version }),
          });
          return response.status;
        },
        { before, written },
      );
      expect([200, 409, 'concurrent-edit']).toContain(restored);
    }
    await publicPage.close();
  }
});

test('failed saves preserve selection and conflicts require an explicit reload', async ({ page }) => {
  let saved: Appearance = { theme: 'interval', version: 1, updatedAt: '', updatedBy: 'owner' };
  let failure = 503;
  await page.route('**/admin/api/productions', (route) => route.fulfill({ json: { productions: [] } }));
  await page.route('**/admin/api/episodes', (route) => route.fulfill({ json: { episodes: [] } }));
  await page.route('**/admin/api/categories', (route) => route.fulfill({ json: { categories: [] } }));
  await page.route('**/admin/api/session', (route) =>
    route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } }),
  );
  await page.route('**/admin/api/appearance', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: failure, json: { error: failure === 409 ? '外观已被更新' : '连接暂时中断' } })
      : route.fulfill({ json: { appearance: saved } }),
  );
  await page.goto('/admin/appearance');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc('interval'));
  await page.getByRole('radio', { name: '01 · 林间电台', exact: true }).click();
  await page.getByRole('button', { name: '应用到公开网站' }).click();
  await expect(page.getByRole('alert')).toContainText('连接暂时中断');
  await expect(page.getByRole('radio', { name: '01 · 林间电台', exact: true })).toBeChecked();
  failure = 409;
  await page.getByRole('button', { name: '应用到公开网站' }).click();
  await expect(page.getByRole('button', { name: '应用到公开网站' })).toBeDisabled();
  saved = { ...saved, theme: 'stillwood', version: 2 };
  await page.getByRole('button', { name: '读取最新设置' }).click();
  const current = page.getByRole('radio', { name: '05 · 雾林来信', exact: true });
  await expect(current).toBeChecked();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', themeFaviconSrc('stillwood'));
  expect(
    await page.locator('.admin-rail-mark').evaluate((element) => element.style.getPropertyValue('--ink')),
  ).toBe(themes.stillwood.palette[1]);
  await current.focus();
  await page.keyboard.down('ArrowDown');
  await expect(page.getByRole('radio', { name: '06 · 岛屿时间', exact: true })).toBeChecked();
  await page.keyboard.up('ArrowDown');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/appearance/admin-mobile-dark.png', fullPage: true });
});

test('theme choices align padded content and retain selection and keyboard focus without an outer frame', async ({
  page,
}, testInfo) => {
  const writes: string[] = [];
  await page.route('**/admin/api/**', (route) => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(request.url());
    if (new URL(request.url()).pathname === '/admin/api/session')
      return route.fulfill({ json: { mode: 'local', user: { email: 'editor@his.fm' } } });
    if (new URL(request.url()).pathname === '/admin/api/productions')
      return route.fulfill({ json: { productions: [] } });
    if (new URL(request.url()).pathname === '/admin/api/episodes')
      return route.fulfill({ json: { episodes: [] } });
    if (new URL(request.url()).pathname === '/admin/api/categories')
      return route.fulfill({ json: { categories: [] } });
    if (new URL(request.url()).pathname === '/admin/api/appearance')
      return route.fulfill({
        json: { appearance: { theme: 'interval', version: 1, updatedAt: '', updatedBy: 'owner' } },
      });
    return route.fulfill({ status: 404, json: { error: 'Unexpected API' } });
  });
  await page.goto('/admin/appearance');
  const group = page.getByRole('radiogroup', { name: '网站视觉主题' });
  const frame = page.locator('.appearance-page > fieldset');
  await expect(group).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.querySelectorAll<HTMLImageElement>('.appearance-mini img')].map((image) => {
        image.loading = 'eager';
        return image.decode();
      }),
    );
  });
  for (const width of [1440, 1024, 393]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 393) {
      await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
    }
    await expect(frame).toHaveCSS('border-width', '0px');
    await expect(frame).toHaveCSS('padding', '0px');
    await expect(frame).toHaveCSS('margin', '0px');
    for (const card of await page.locator('.appearance-option').all()) {
      await expect(card.locator('.appearance-choice')).toHaveCSS('padding', '16px');
      const spacing = await card.evaluate((element) => {
        const rect = (selector: string) => {
          const child = element.querySelector(selector);
          if (!child) throw new Error(`Missing ${selector}`);
          return child.getBoundingClientRect();
        };
        const body = rect('.appearance-choice');
        const title = rect('strong');
        const english = rect('.appearance-english');
        const description = rect('.appearance-description');
        const radio = rect('[role="radio"]');
        const mini = rect('.appearance-mini');
        const heading = rect('.mini-heading');
        const current = element.querySelector('.appearance-current')?.getBoundingClientRect();
        return {
          left: radio.left - body.left,
          textOffset: description.left - body.left,
          englishOffset: english.left - title.left,
          right: body.right - description.right,
          radioAlignment: (radio.top + radio.bottom - title.top - title.bottom) / 2,
          badgeGap: current ? current.left - title.right : null,
          paletteLeft: rect('.appearance-palette').left - body.left,
          headingBottom: mini.bottom - heading.bottom,
          headingRight: mini.right - heading.right,
        };
      });
      expect(spacing.left).toBeCloseTo(16, 1);
      expect(spacing.right).toBeCloseTo(16, 1);
      expect(spacing.textOffset).toBeCloseTo(16, 1);
      expect(spacing.englishOffset).toBeCloseTo(0, 1);
      expect(spacing.radioAlignment).toBeCloseTo(0, 1);
      expect(spacing.paletteLeft).toBeCloseTo(16, 1);
      expect(spacing.headingBottom).toBeGreaterThan(8);
      expect(spacing.headingRight).toBeGreaterThan(8);
      if (spacing.badgeGap !== null) expect(spacing.badgeGap).toBeGreaterThanOrEqual(12);
    }
    const choice = group.getByRole('radio', { name: '01 · 林间电台', exact: true });
    await choice.click();
    await expect(choice).toBeChecked();
    await expect(page.locator('.appearance-option[data-selected="true"]')).toHaveCount(1);
    await expect(page.locator('.appearance-option[data-selected="true"]')).not.toHaveCSS(
      'box-shadow',
      'none',
    );
    await choice.focus();
    await page.keyboard.down('ArrowDown');
    const next = group.getByRole('radio', { name: '02 · 间隙', exact: true });
    await expect(next).toBeChecked();
    await expect(next).toBeFocused();
    await page.keyboard.up('ArrowDown');
    expect(await next.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    await expect(next).not.toHaveCSS('box-shadow', 'none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`appearance-${width}.png`), animations: 'disabled' });
  }
  expect(writes).toEqual([]);
});
