import { defineConfig, devices } from '@playwright/test';

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ci ? ['**/ci-smoke.spec.ts'] : ['**/*.spec.ts'],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.HISFM_E2E_BASE_URL ?? (ci ? 'http://127.0.0.1:27056' : 'https://hisfm.dev.hexly.ai'),
    ignoreHTTPSErrors: true,
    ...(ci ? {} : { channel: 'chrome' }),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    reducedMotion: 'reduce',
    colorScheme: 'light',
  },
  ...(ci
    ? {
        webServer: {
          command: 'node scripts/e2e-preview.mjs',
          url: 'http://127.0.0.1:27056/api/live',
          reuseExistingServer: false,
          timeout: 60_000,
        },
      }
    : {}),
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
});
