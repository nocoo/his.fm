import { defineConfig } from 'vitest/config';

process.env.MINIFLARE_CACHE_DIR = '.cloudflare/cache';

export default defineConfig({
  define: { __BUILD_REVISION__: JSON.stringify('test-revision') },
  cacheDir: 'coverage/.vite',
  test: {
    environment: 'node',
    maxWorkers: 4,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'src/shared/**/*.ts',
        'src/admin/environment.ts',
        'scripts/production-proxy.ts',
        'worker/**/*.ts',
        'src/**/model.ts',
        'src/**/*.model.ts',
        'src/**/models/**/*.ts',
        'src/**/service.ts',
        'src/**/services/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.tsx',
        'src/**/views/**',
        'src/**/*View.ts',
        'src/shared/useResolvedThemeId.ts',
        'src/shared/seo-client.ts',
        'worker/episode-public.ts',
        'worker/episode-numbering.ts',
        'worker/public-html.ts',
        'src/shared/seo-head.ts',
        'src/shared/seo.ts',
        'worker/feed.ts',
        'worker/seo-store.ts',
        'worker/llms-full.ts',
        'worker/sitemap.ts',
        'worker/robots.ts',
        'src/shared/seo-resolve.ts',
        'src/shared/mentions-format.ts',
        'worker/agent-contract.ts',
        'worker/index.ts',
      ],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
