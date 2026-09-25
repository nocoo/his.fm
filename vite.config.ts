import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
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
