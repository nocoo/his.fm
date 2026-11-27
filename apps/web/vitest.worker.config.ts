import { defineConfig } from 'vitest/config';

process.env.MINIFLARE_CACHE_DIR = '.cloudflare/cache';

export default defineConfig({
  define: { __BUILD_REVISION__: JSON.stringify('test-revision') },
  cacheDir: 'coverage-worker/.vite',
  test: {
    environment: 'node',
    onUnhandledError(error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Writer is not bound to a WritableStream')) return false;
    },
    maxWorkers: 4,
    include: ['tests/worker/**/*.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage-worker',
      include: ['worker/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'worker/**/*.d.ts',
        'worker/episode-public.ts',
        'worker/episode-numbering.ts',
        'worker/public-html.ts',
        'worker/feed.ts',
        'worker/seo-store.ts',
        'worker/llms-full.ts',
        'worker/sitemap.ts',
        'worker/robots.ts',
        'worker/agent-contract.ts',
        'worker/index.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
