import { expect, test } from '@playwright/test';

const scenarios = [
  { name: 'saved dark', stored: 'dark', system: 'light', expected: 'dark', path: '/login' },
  { name: 'saved light', stored: 'light', system: 'dark', expected: 'light', path: '/login' },
  { name: 'system dark', stored: 'system', system: 'dark', expected: 'dark', path: '/admin' },
  { name: 'system light', stored: null, system: 'light', expected: 'light', path: '/login' },
  { name: 'invalid preference', stored: 'invalid', system: 'dark', expected: 'dark', path: '/login' },
  { name: 'denied storage', stored: null, system: 'dark', expected: 'dark', path: '/login' },
] as const;

for (const scenario of scenarios) {
  test(`loading canvas respects ${scenario.name} before React and lazy routes`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript(({ stored, name }) => {
      if (name === 'denied storage') {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('Storage is denied', 'SecurityError');
          },
        });
      } else if (stored) {
        localStorage.setItem('hisfm-theme', stored);
      }
    }, scenario);
    let releaseMain = () => {};
    let releaseAdmin = () => {};
    const main = new Promise<void>((resolve) => {
      releaseMain = resolve;
    });
    const admin = new Promise<void>((resolve) => {
      releaseAdmin = resolve;
    });
    await page.route(/\/(?:src\/main\.tsx|assets\/index-[^/]+\.js)(?:\?|$)/, async (route) => {
      await main;
      await route.continue();
    });
    await page.route(
      /\/(?:src\/admin\/AdminRoutes\.tsx|assets\/AdminRoutes-[^/]+\.js)(?:\?|$)/,
      async (route) => {
        await admin;
        await route.continue();
      },
    );
    await page.route('**/admin/api/session', (route) =>
      route.fulfill({ status: 401, json: { error: 'Sign in required' } }),
    );
    try {
      await page.goto(scenario.path, { waitUntil: 'commit' });
      const root = page.locator('html');
      const background = scenario.expected === 'dark' ? 'rgb(23, 23, 23)' : 'rgb(238, 239, 242)';
      await expect(root).toHaveAttribute('data-mode', scenario.expected);
      await expect(root).toHaveCSS('color-scheme', scenario.expected);
      await expect(root).toHaveCSS('background-color', background);
      await expect(page.locator('#root')).toBeEmpty();
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', background);

      releaseMain();
      const loading = page.locator('.app-loading');
      await expect(loading).toHaveText('正在打开 his.fm…');
      await expect(loading).toHaveCSS('background-color', background);
      await expect(root).toHaveCSS('background-color', background);
      await expect(loading).toHaveCSS(
        'color',
        scenario.expected === 'dark' ? 'rgb(237, 237, 237)' : 'rgb(31, 31, 31)',
      );

      releaseAdmin();
      await expect(page.getByRole('heading', { name: '欢迎回到工作室' })).toBeVisible();
      await expect(root).toHaveCSS('background-color', background);
      await expect(root).toHaveCSS('color-scheme', scenario.expected);
      await expect(page.locator('.admin-app')).toHaveCSS('background-color', background);
      expect(errors).toEqual([]);
    } finally {
      releaseMain();
      releaseAdmin();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
