import { execFileSync } from 'node:child_process';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { productionProxy } from './scripts/production-proxy.ts';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

export default defineConfig(({ mode }) => ({
  html: {
    cspNonce: '__HISFM_CSP_NONCE__',
  },
  define: {
    __BUILD_REVISION__: JSON.stringify(
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ),
  },
  plugins: [
    react(),
    productionProxy(),
    cloudflare({
      // `--mode development` runs against local Miniflare state; any other mode keeps the
      // production bindings of cloudflare.config.ts and talks to the real D1 and R2.
      remoteBindings: mode !== 'development',
      inspectorPort: false,
      ...(process.env.CLOUDFLARE_PERSIST_STATE
        ? { persistState: { path: process.env.CLOUDFLARE_PERSIST_STATE } }
        : {}),
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 7056,
    strictPort: true,
    allowedHosts: ['hisfm.dev.hexly.ai'],
  },
}));
