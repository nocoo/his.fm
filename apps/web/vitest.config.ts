import { configDefaults, defineConfig } from 'vitest/config';

process.env.MINIFLARE_CACHE_DIR = '.cloudflare/cache';

export default defineConfig({
  define: { __BUILD_REVISION__: JSON.stringify('test-revision') },
  cacheDir: 'coverage/.vite',
  test: {
    environment: 'node',
    onUnhandledError(error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Writer is not bound to a WritableStream')) return false;
    },
    maxWorkers: 4,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/worker/**'],
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
        'src/shared/seo-head.ts',
        'src/shared/seo.ts',
        'src/shared/seo-resolve.ts',
        'src/shared/mentions-format.ts',
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
