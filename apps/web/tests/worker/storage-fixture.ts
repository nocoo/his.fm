import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { StorageCleanupResult, StoragePage } from '../../src/shared/storage';
import worker from '../../worker';

export const origin = 'https://hisfm.dev.hexly.ai';

export async function createStorageEnv(name: string) {
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name,
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: 'export default { fetch() { return new Response("ok"); } }',
              },
            },
          },
          env: {
            DB: { type: 'd1', name },
            MEDIA: { type: 'r2', name },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  const env = await mf.getBindings<Env>();
  for (const file of readdirSync('migrations')
    .filter((item) => item.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(`migrations/${file}`, 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
  }
  return { mf, env };
}

export async function resetStorageEnv(env: Env) {
  await env.DB.batch([
    ...[
      'media_provenance',
      'episodes',
      'productions',
      'episode_number_claims',
      'channel_profile',
      'storage_gc_queue',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare("UPDATE site_seo SET data = '{}' WHERE id = 1"),
    env.DB.prepare("UPDATE categories SET seo = '{}', prompt_slots = NULL, prompt_slots_version = 0"),
    env.DB.prepare("UPDATE site_appearance SET theme = 'stillwood', version = 1"),
  ]);
  let objects = await env.MEDIA.list({ limit: 1000 });
  const keys = objects.objects.map((object) => object.key);
  while (objects.truncated) {
    objects = await env.MEDIA.list({ cursor: objects.cursor });
    keys.push(...objects.objects.map((object) => object.key));
  }
  if (keys.length) await env.MEDIA.delete(keys);
  const login = await worker.fetch(
    new Request(`${origin}/admin/api/dev-login`, { method: 'POST', headers: { Origin: origin } }),
    env,
  );
  return login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}

export function callStorage(env: Env, cookie: string, path = '', init: RequestInit = {}, bindings = env) {
  return worker.fetch(
    new Request(`${origin}/admin/api/storage${path}`, {
      ...init,
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...init.headers },
    }),
    bindings,
  );
}

export async function scanStorage(env: Env, cookie: string, bindings = env): Promise<StoragePage> {
  const response = await callStorage(env, cookie, '', {}, bindings);
  if (response.status !== 200) throw new Error(`Unexpected scan status ${response.status}`);
  return response.json();
}

export function putStorageObject(env: Env, key: string, type?: string) {
  return env.MEDIA.put(key, '0123456789', { httpMetadata: type ? { contentType: type } : undefined });
}

export function agedEnv(bindings: Env): Env {
  const old = (object: R2Object) => ({ ...object, uploaded: new Date('2020-01-01') });
  return {
    ...bindings,
    MEDIA: {
      head: async (key: string) => {
        const object = await bindings.MEDIA.head(key);
        return object ? old(object) : null;
      },
      list: async (options?: R2ListOptions) => {
        const page = await bindings.MEDIA.list(options);
        return { ...page, objects: page.objects.map(old) };
      },
      delete: (key: string | string[]) => bindings.MEDIA.delete(key),
    } as R2Bucket,
  };
}

export async function cleanupStorage(
  env: Env,
  cookie: string,
  items: { key: string; version: string }[],
  bindings = agedEnv(env),
) {
  const response = await callStorage(
    env,
    cookie,
    '/cleanup',
    { method: 'POST', body: JSON.stringify({ items }) },
    bindings,
  );
  if (response.status !== 200) throw new Error(`Unexpected cleanup status ${response.status}`);
  return ((await response.json()) as StorageCleanupResult).results;
}
