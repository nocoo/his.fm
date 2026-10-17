import { bindings, defineConfig, exports } from 'cf/config';

process.env.MINIFLARE_CACHE_DIR = '.cloudflare/cache';

export default defineConfig(({ mode }) => {
  const local = mode === 'development';
  const name = local ? 'his-fm-local' : 'his-fm';
  return {
    worker: {
      name,
      entrypoint: 'worker/entry.ts',
      compatibilityDate: '2026-09-24',
      compatibilityFlags: ['nodejs_compat'],
      workersDev: false,
      previewUrls: false,
      domains: local ? [] : ['his.fm'],
      observability: { enabled: !local },
      exports: local ? undefined : { AgentHub: exports.durableObject({ state: 'deleted' }) },
      assets: {
        notFoundHandling: 'single-page-application',
        runWorkerFirst: [
          '/api/*',
          '/feed.xml',
          '/feeds/*',
          '/sitemap.xml',
          '/robots.txt',
          '/llms.txt',
          '/llms-full.txt',
          '/',
          '/about',
          '/episodes',
          '/episodes/*',
          '/.well-known/api-catalog',
          '/admin',
          '/admin/*',
          '/media/*',
        ],
      },
      env: {
        ENVIRONMENT: bindings.text<string>(local ? 'local' : 'production'),
        MEDIA_BASE_URL: bindings.text<string>(local ? '/media' : 'https://f.no.mt'),
        DB: bindings.d1({
          name: 'his-fm',
          id: local ? '00000000-0000-4000-8000-000000007056' : '66f7e201-22a8-450d-838d-ecbc382afbc6',
        }),
        MEDIA: bindings.r2({ name: 'his-fm' }),
        BUILD_INFO: bindings.versionMetadata(),
        ASSETS: bindings.assets(),
      },
    },
  };
});
