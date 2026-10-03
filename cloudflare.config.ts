import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig(({ mode }) => {
  const local = mode === 'development';
  const name = local ? 'his-fm-local' : 'his-fm';
  const workflow = local ? 'his-fm-audio-local' : 'his-fm-audio';
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
      assets: {
        notFoundHandling: 'single-page-application',
        runWorkerFirst: ['/api/*', '/.well-known/api-catalog', '/llms.txt', '/admin', '/admin/*', '/media/*'],
      },
      exports: { AudioWorkflow: exports.workflow({ name: workflow }) },
      env: {
        ENVIRONMENT: bindings.text<string>(local ? 'local' : 'production'),
        MEDIA_BASE_URL: bindings.text<string>(local ? '/media' : 'https://f.no.mt'),
        GEMINI_API_KEY: bindings.secret(),
        DB: bindings.d1({
          name: 'his-fm',
          id: local ? '00000000-0000-4000-8000-000000007056' : '66f7e201-22a8-450d-838d-ecbc382afbc6',
        }),
        MEDIA: bindings.r2({ name: 'his-fm' }),
        AUDIO_WORKFLOW: bindings.workflow({ name: workflow, worker: name, exportName: 'AudioWorkflow' }),
        BUILD_INFO: bindings.versionMetadata(),
        ASSETS: bindings.assets(),
      },
    },
  };
});
