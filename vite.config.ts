import { execFileSync } from 'node:child_process';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { productionProxy } from './scripts/production-proxy.ts';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

export default defineConfig(({ command }) => ({
  define: {
    __BUILD_REVISION__: JSON.stringify(
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ),
  },
  plugins: [
    react(),
    productionProxy(),
    cloudflare({
      configPath: command === 'serve' ? 'wrangler.local.jsonc' : 'wrangler.jsonc',
      inspectorPort: false,
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 7056,
    strictPort: true,
    allowedHosts: ['hisfm.dev.hexly.ai'],
  },
}));
