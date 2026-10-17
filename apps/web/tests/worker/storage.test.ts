import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageCleanupResult, StoragePage } from '../../src/shared/storage';
import worker from '../../worker';
import { readyFixture } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const origin = 'https://hisfm.dev.hexly.ai';
let mf: Miniflare;
let env: Env;
let cookie = '';

async function call(path = '', init: RequestInit = {}, bindings = env) {
  return worker.fetch(
    new Request(`${origin}/admin/api/storage${path}`, {
      ...init,
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...init.headers },
    }),
    bindings,
  );
}
async function scan(bindings = env): Promise<StoragePage> {
  const response = await call('', {}, bindings);
  expect(response.status).toBe(200);
  return response.json();
}
async function put(key: string, type?: string) {
  return env.MEDIA.put(key, '0123456789', { httpMetadata: type ? { contentType: type } : undefined });
}
function aged(bindings = env): Env {
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
async function remove(items: { key: string; version: string }[], bindings = aged()) {
  const response = await call('/cleanup', { method: 'POST', body: JSON.stringify({ items }) }, bindings);
  expect(response.status).toBe(200);
  return ((await response.json()) as StorageCleanupResult).results;
}

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'storage-test',
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
            DB: { type: 'd1', name: 'storage-test' },
            MEDIA: { type: 'r2', name: 'storage-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  for (const name of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(`migrations/${name}`, 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
  }
}, 30000);
beforeEach(async () => {
  await env.DB.batch(
    ['media_provenance', 'episodes', 'productions', 'episode_number_claims', 'channel_profile'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  await env.DB.batch([
    env.DB.prepare("UPDATE site_seo SET data = '{}' WHERE id = 1"),
    env.DB.prepare("UPDATE categories SET seo = '{}'"),
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
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await mf.dispose();
});

describe('owner R2 inventory and cleanup', () => {
  it('protects uploaded site, episode and category SEO images and episode mentions during cleanup', async () => {
    const keys = [
      'site-og',
      'site-cover',
      'site-override',
      'episode-og',
      'category-og',
      'mention',
      'production-og',
    ].map((name) => `uploads/${name}.png`);
    await env.DB.prepare('UPDATE site_seo SET data = ? WHERE id = 1')
      .bind(
        JSON.stringify({
          defaultOgImageUrl: `https://f.no.mt/${keys[0]}`,
          podcastCoverUrl: `/media/${keys[1]}`,
          overrides: { ogImageUrl: `https://his.fm/media/${keys[2]}` },
        }),
      )
      .run();
    await env.DB.prepare('UPDATE categories SET seo = ? WHERE id = ?')
      .bind(JSON.stringify({ ogImageUrl: `https://f.no.mt/${keys[4]}` }), 'life')
      .run();
    await env.DB.prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, status, created_at, updated_at, seo, mentions)
      VALUES ('seo-episode', 'seo-episode', 1, '节目', '', '', '', '/images/episode-01.webp', 'life', 'draft', 'now', 'now', ?, ?)`)
      .bind(
        JSON.stringify({ ogImageUrl: `/media/${keys[3]}` }),
        JSON.stringify([{ name: '图片', description: '节目提及', url: `https://f.no.mt/${keys[5]}` }]),
      )
      .run();
    const production = readyFixture({ seo: { ogImageUrl: `/media/${keys[6]}` } });
    await env.DB.prepare('INSERT INTO productions VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(
        production.id,
        production.version,
        production.stage,
        JSON.stringify(production),
        production.createdAt,
        production.updatedAt,
        crypto.randomUUID(),
      )
      .run();
    for (const key of keys) await put(key, 'image/png');
    const objects = (await scan(aged())).objects;
    expect(objects).toHaveLength(keys.length);
    expect(objects.every((object) => object.state === 'referenced')).toBe(true);
    expect(
      (await remove(objects.map(({ key, version }) => ({ key, version })))).every(
        (result) => result.status === 'skipped',
      ),
    ).toBe(true);
    for (const key of keys) expect(await env.MEDIA.head(key)).not.toBeNull();
  });

  it('revalidates newly saved SEO references rather than trusting an earlier unused scan', async () => {
    const object = await put('uploads/newly-configured.png');
    expect((await scan(aged())).objects[0].state).toBe('unused');
    await env.DB.prepare('UPDATE site_seo SET data = ? WHERE id = 1')
      .bind(JSON.stringify({ defaultOgImageUrl: `https://f.no.mt/${object.key}` }))
      .run();
    expect(await remove([{ key: object.key, version: object.version }])).toEqual([
      expect.objectContaining({ key: object.key, status: 'skipped', reason: '站点 SEO' }),
    ]);
    expect(await env.MEDIA.head(object.key)).not.toBeNull();
  });

  it('requires owner authentication and same-origin writes with strict bounded inputs', async () => {
    expect((await call('', { headers: { Cookie: '' } })).status).toBe(401);
    expect((await call('/object?key=x', { headers: { Cookie: '' } })).status).toBe(401);
    expect(
      (await call('/cleanup', { method: 'POST', headers: { Origin: 'https://other.test' } })).status,
    ).toBe(403);
    for (const [path, method, status] of [
      ['', 'POST', 415],
      ['/cleanup', 'GET', 405],
      ['/object', 'PUT', 405],
      ['/missing', 'GET', 404],
      ['/object', 'GET', 400],
      ['/object?key=missing', 'GET', 404],
      [`?cursor=${'x'.repeat(4097)}`, 'GET', 400],
    ] as const) {
      expect((await call(path, { method })).status).toBe(status);
    }
    for (const items of [
      [],
      [{ key: '', version: 'x' }],
      Array.from({ length: 51 }, () => ({ key: 'x', version: 'v' })),
    ]) {
      expect((await call('/cleanup', { method: 'POST', body: JSON.stringify({ items }) })).status).toBe(400);
    }
    expect(await scan()).toEqual({ objects: [], cursor: null });
  });

  it('protects persisted assets, text links, brand assets and active-job chunks and bumpers', async () => {
    const production = readyFixture();
    production.sources = [
      {
        id: 'source-1',
        type: 'text',
        title: '素材',
        content:
          '[图片](https://f.no.mt/source%20image.webp?x=1)。 https://other.test/not-ours.wav https://f.no.mt/%ZZ',
      },
    ];
    await env.DB.prepare('INSERT INTO productions VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(
        production.id,
        1,
        'ready',
        JSON.stringify(production),
        production.createdAt,
        production.updatedAt,
        crypto.randomUUID(),
      )
      .run();
    await env.DB.prepare("INSERT INTO media_provenance VALUES ('settings', ?)")
      .bind(JSON.stringify({ intro: { key: 'bumper-current.wav' }, outro: null }))
      .run();
    await env.DB.prepare(
      "INSERT INTO channel_profile (id, version, content, updated_at, updated_by) VALUES (1, 1, ?, 'now', 'owner')",
    )
      .bind('https://f.no.mt/channel.webp')
      .run();
    await env.DB.prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, status, created_at, updated_at)
      VALUES ('episode', 'episode', 1, '目录标题', '', '/media/transcript.wav', 'https://his.fm/media/notes.wav', 'https://f.no.mt/published.webp', 'life', 'draft', 'now', 'now')`).run();
    for (const [id] of [
      ['active', 'running'],
      ['queued', 'queued'],
      ['done', 'complete'],
      ['failed', 'failed'],
    ]) {
      const snapshot = {
        jobId: id,
        productionId: production.id,
        scriptVersion: 1,
        introKey: `bumper-${id}.wav`,
        outroKey: null,
      };
      await env.DB.prepare('INSERT INTO media_provenance VALUES (?, ?)')
        .bind(id, JSON.stringify(snapshot))
        .run();
      await put(`audio/${production.id}/1/${id}/part-001.wav`);
      await put(`bumper-${id}.wav`);
    }
    for (const key of [
      'cover.png',
      'audio.wav',
      'source image.webp',
      'channel.webp',
      'published.webp',
      'transcript.wav',
      'notes.wav',
      'bumper-current.wav',
      'images/hero.webp',
      'reference/voices/Kore.wav',
      'not-ours.wav',
      'unused.mp4',
    ])
      await put(key);
    const objects = (await scan(aged())).objects;
    const states = Object.fromEntries(objects.map((object) => [object.key, object.state]));
    for (const key of [
      'cover.png',
      'audio.wav',
      'source image.webp',
      'channel.webp',
      'published.webp',
      'transcript.wav',
      'notes.wav',
      'bumper-current.wav',
      'bumper-active.wav',
      'bumper-queued.wav',
      'bumper-done.wav',
      'bumper-failed.wav',
    ])
      expect(states[key]).toBe('referenced');
    for (const key of ['images/hero.webp', 'reference/voices/Kore.wav'])
      expect(states[key]).toBe('protected');
    for (const key of [
      'unused.mp4',
      'not-ours.wav',
      'audio/production-test/1/active/part-001.wav',
      'audio/production-test/1/queued/part-001.wav',
      'audio/production-test/1/done/part-001.wav',
      'audio/production-test/1/failed/part-001.wav',
    ])
      expect(states[key]).toBe('unused');
    const protectedItems = objects.filter((object) => object.state !== 'unused');
    expect(await remove(protectedItems.map(({ key, version }) => ({ key, version })))).toHaveLength(
      protectedItems.length,
    );
    for (const object of protectedItems) expect(await env.MEDIA.head(object.key)).not.toBeNull();
  });

  it('keeps new uploads, rechecks references, detects replacement and reports individual failure', async () => {
    const fresh = await put('fresh.wav', 'audio/wav');
    expect((await scan()).objects[0]).toMatchObject({
      state: 'recent',
      kind: 'audio',
      contentType: 'audio/wav',
    });
    expect((await remove([{ key: fresh.key, version: fresh.version }], env))[0].status).toBe('skipped');
    const used = await put('new-reference.wav');
    const replaced = await put('replaced.png');
    const gone = await put('gone.mp4');
    const failed = await put('failed.mp4');
    const disposable = await put('disposable.mp4');
    const items = [used, replaced, gone, failed, disposable].map(({ key, version }) => ({ key, version }));
    await env.DB.prepare("INSERT INTO media_provenance VALUES ('settings', ?)")
      .bind(JSON.stringify({ outro: { key: used.key } }))
      .run();
    await put(replaced.key);
    await env.MEDIA.delete(gone.key);
    const bindings = aged();
    const original = bindings.MEDIA.delete;
    bindings.MEDIA.delete = async (key) => {
      if (key === failed.key) throw new Error('R2 unavailable');
      await original(key);
    };
    const results = await remove([...items, items[4]], bindings);
    expect(results.map((result) => result.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'failed',
      'deleted',
    ]);
    expect(results.at(-1)?.bytes).toBe(10);
    expect(await env.MEDIA.head(used.key)).not.toBeNull();
    expect(await env.MEDIA.head(replaced.key)).not.toBeNull();
    expect(await env.MEDIA.head(failed.key)).not.toBeNull();
    expect(await env.MEDIA.head(disposable.key)).toBeNull();
  });

  it('follows actual R2 pagination instead of assuming a full page', async () => {
    await Promise.all(
      Array.from({ length: 205 }, (_, i) => put(`files/${String(i).padStart(3, '0')}.webp`, 'image/webp')),
    );
    let page = await scan();
    const keys = page.objects.map((object) => object.key);
    expect(page.cursor).toBeTruthy();
    while (page.cursor) {
      page = (await (await call(`?cursor=${encodeURIComponent(page.cursor)}`)).json()) as StoragePage;
      keys.push(...page.objects.map((object) => object.key));
    }
    expect(keys).toHaveLength(205);
    expect(new Set(keys).size).toBe(205);
  });

  it('fails closed when reference lookup is unavailable', async () => {
    const object = await put('old.wav');
    const bindings = {
      ...aged(),
      DB: {
        batch: async () => {
          throw new Error('D1 unavailable');
        },
        prepare: env.DB.prepare.bind(env.DB),
      } as unknown as D1Database,
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('', {}, bindings)).status).toBe(500);
    expect(
      (
        await call(
          '/cleanup',
          { method: 'POST', body: JSON.stringify({ items: [{ key: object.key, version: object.version }] }) },
          bindings,
        )
      ).status,
    ).toBe(500);
    expect(await env.MEDIA.head(object.key)).not.toBeNull();
  });

  it('fails closed when any reference query returns a partial unsuccessful result', async () => {
    const object = await put('uploads/partial-scan.png');
    const bindings = {
      ...aged(),
      DB: {
        prepare: env.DB.prepare.bind(env.DB),
        batch: async (statements: D1PreparedStatement[]) => {
          const results = await env.DB.batch(statements);
          return results.map((result, index) =>
            index === results.length - 1 ? { ...result, success: false, results: [] } : result,
          );
        },
      } as unknown as D1Database,
    };
    expect((await call('', {}, bindings)).status).toBe(503);
    expect(
      (
        await call(
          '/cleanup',
          {
            method: 'POST',
            body: JSON.stringify({
              items: [{ key: object.key, version: object.version }],
            }),
          },
          bindings,
        )
      ).status,
    ).toBe(503);
    expect(await env.MEDIA.head(object.key)).not.toBeNull();
  });
});

describe('authenticated streaming previews', () => {
  it('streams full media, HEAD and bounded byte ranges for seeking', async () => {
    const object = await put('声音 & image.wav', 'audio/wav');
    const path = `/object?key=${encodeURIComponent(object.key)}`;
    const full = await call(path);
    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Type')).toBe('audio/wav');
    expect(full.headers.get('Cache-Control')).toContain('no-store');
    expect(full.headers.get('Content-Disposition')).toContain('inline');
    expect(await full.text()).toBe('0123456789');
    const head = await call(path, { method: 'HEAD', headers: { Range: 'bytes=2-4' } });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('10');
    expect(await head.text()).toBe('');
    for (const [range, expected, contentRange] of [
      ['bytes=2-4', '234', 'bytes 2-4/10'],
      ['bytes=8-', '89', 'bytes 8-9/10'],
      ['bytes=-3', '789', 'bytes 7-9/10'],
      ['bytes=8-100', '89', 'bytes 8-9/10'],
      ['bytes=-100', '0123456789', 'bytes 0-9/10'],
    ]) {
      const response = await call(path, { headers: { Range: range, 'If-Range': object.httpEtag } });
      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toBe(contentRange);
      expect(await response.text()).toBe(expected);
    }
    const mismatch = await call(path, { headers: { Range: 'bytes=0-2', 'If-Range': '"outdated"' } });
    expect(mismatch.status).toBe(200);
    expect(await mismatch.text()).toBe('0123456789');
    for (const range of [
      'nonsense',
      'bytes=-',
      'bytes=-0',
      'bytes=30-',
      'bytes=8-2',
      'bytes=0-1,4-5',
      'bytes=999999999999999999999-',
    ]) {
      const response = await call(path, { headers: { Range: range } });
      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe('bytes */10');
    }
  });
  it('downloads active formats and detects changed objects without buffering', async () => {
    await put('unsafe.svg', 'image/svg+xml');
    await put('unknown');
    for (const key of ['unsafe.svg', 'unknown']) {
      const response = await call(`/object?key=${key}`);
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(response.headers.get('Content-Disposition')).toContain('attachment');
      await response.body?.cancel();
    }
    const object = await put('changed.wav', 'audio/wav');
    const bindings = {
      ...env,
      MEDIA: { head: env.MEDIA.head.bind(env.MEDIA), get: async () => object } as unknown as R2Bucket,
    };
    expect((await call('/object?key=changed.wav', {}, bindings)).status).toBe(409);
    bindings.MEDIA.get = async () => null;
    expect((await call('/object?key=changed.wav', {}, bindings)).status).toBe(409);
  });
});
