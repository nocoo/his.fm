import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./tests/worker/runtime.ts', import.meta.url).pathname,
      'cloudflare:workflows': new URL('./tests/worker/runtime.ts', import.meta.url).pathname,
    },
  },
  define: { __BUILD_REVISION__: JSON.stringify('test-revision') },
  cacheDir: 'coverage/.vite',
  test: {
    environment: 'node',
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
        'src/**/models/**/*.ts',
        'src/**/service.ts',
        'src/**/services/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.tsx', 'src/**/views/**', 'src/**/*View.ts'],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
