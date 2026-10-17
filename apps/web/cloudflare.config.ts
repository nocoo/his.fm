import { bindings, defineConfig, exports } from 'cf/config';
import * as entrypoint from './worker/entry' with { type: 'cf-worker' };

process.env.MINIFLARE_CACHE_DIR = '.cloudflare/cache';

export default defineConfig(({ mode }) => {
  const local = mode === 'development';
  const name = local ? 'his-fm-local' : 'his-fm';
  return {
    worker: {
      name,
      entrypoint,
      compatibilityDate: '2026-09-24',
      compatibilityFlags: ['nodejs_compat'],
      workersDev: false,
      previewUrls: false,
      domains: local ? [] : ['his.fm', 'www.his.fm'],
      observability: { enabled: !local },
      cache: { enabled: false },
      exports: {
        PublicContent: exports.worker({ cache: { enabled: !local } }),
        ...(!local ? { AgentHub: exports.durableObject({ state: 'deleted' }) } : {}),
      },
      assets: {
        notFoundHandling: 'none',
        runWorkerFirst: true,
      },
      env: {
        ENVIRONMENT: bindings.text<string>(local ? 'local' : 'production'),
        MEDIA_BASE_URL: bindings.text<string>(local ? '/media' : 'https://f.no.mt'),
        DB: bindings.d1({
          name: 'his-fm',
          id: local ? '00000000-0000-4000-8000-000000007056' : '66f7e201-22a8-450d-838d-ecbc382afbc6',
        }),
        MEDIA: bindings.r2({ name: 'his-fm' }),
        IMAGES: bindings.images(),
        BUILD_INFO: bindings.versionMetadata(),
        ASSETS: bindings.assets(),
      },
    },
  };
});
