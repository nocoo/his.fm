import type { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { artLocation } from '../../src/shared/episode-art';
import type { StorageCleanupResult } from '../../src/shared/storage';
import worker from '../../worker';
import { artRecords } from '../../worker/episode-art-cache';
import { readyFixture } from './production-fixture';
import {
  agedEnv,
  callStorage,
  cleanupStorage,
  createStorageEnv,
  origin,
  putStorageObject,
  resetStorageEnv,
  scanStorage,
} from './storage-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

let mf: Miniflare;
let env: Env;
let cookie = '';

const call = (path = '', init: RequestInit = {}, bindings = env) =>
  callStorage(env, cookie, path, init, bindings);
const scan = (bindings = env) => scanStorage(env, cookie, bindings);
const put = (key: string, type?: string) => putStorageObject(env, key, type);
const aged = (bindings = env) => agedEnv(bindings);
const remove = (items: { key: string; version: string }[], bindings = aged()) =>
  cleanupStorage(env, cookie, items, bindings);

beforeAll(async () => {
  ({ mf, env } = await createStorageEnv('storage-test'));
}, 30000);
beforeEach(async () => {
  cookie = await resetStorageEnv(env);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await mf.dispose();
});

describe('owner R2 inventory and cleanup', () => {
  it('routes a versioned single-object deletion through the same reference revalidation', async () => {
    const object = await put('rendered/deleted-record/old.jpg', 'image/jpeg');
    expect((await call('/object', { method: 'DELETE' })).status).toBe(400);
    expect((await call('', { method: 'PUT' })).status).toBe(405);
    const response = await call(
      `/object?key=${encodeURIComponent(object.key)}&version=${encodeURIComponent(object.version)}`,
      { method: 'DELETE' },
      aged(),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as StorageCleanupResult).toEqual({
      results: [{ key: object.key, status: 'deleted', reason: '已删除', bytes: 10 }],
    });
    expect(await env.MEDIA.head(object.key)).toBeNull();
  });

  async function artworkFixtures() {
    const production = readyFixture();
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
    await env.DB.prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, cover_url, category, status, created_at, updated_at)
      VALUES ('art-episode', 'art-episode', 1, '当前节目', '', '', '/images/episode-01.webp', 'life', 'draft', 'now', 'now')`).run();
    return artRecords(env.DB);
  }

  it('protects all current rendered sizes for episodes and productions while collecting superseded versions and themes', async () => {
    const records = await artworkFixtures();
    const current: string[] = [];
    const stale: string[] = [];
    for (const record of records) {
      for (const size of [1400, 1600, 3000]) {
        current.push((await artLocation(record, 'stillwood', size)).key);
      }
      current.push((await artLocation(record, null)).key);
      stale.push(
        (await artLocation(record, 'interval')).key,
        (await artLocation({ ...record, title: '旧标题' }, 'stillwood')).key,
        (await artLocation({ ...record, coverUrl: '/media/old-cover.png' }, 'stillwood')).key,
        (await artLocation({ ...record, coverUrl: '/media/old-cover.png' }, null)).key,
      );
    }
    stale.push('rendered/episodes/deleted/art/stillwood/old/1400.jpg');
    await Promise.all([...current, ...stale].map((key) => put(key, 'image/jpeg')));
    const objects = (await scan(aged())).objects;
    for (const key of current) {
      expect(objects.find((object) => object.key === key)).toMatchObject({
        state: 'referenced',
        reasons: ['当前节目合成图片'],
      });
    }
    for (const key of stale) expect(objects.find((object) => object.key === key)?.state).toBe('unused');
    const results = await remove(objects.map(({ key, version }) => ({ key, version })));
    for (const key of current) {
      expect(results.find((result) => result.key === key)?.status).toBe('skipped');
    }
    for (const key of stale) {
      expect(results.find((result) => result.key === key)?.status).toBe('deleted');
    }
    await Promise.all([
      ...current.map(async (key) => expect(await env.MEDIA.head(key)).not.toBeNull()),
      ...stale.map(async (key) => expect(await env.MEDIA.head(key)).toBeNull()),
    ]);
  });

  it('revalidates newly current rendered prefixes for both resource types instead of trusting an unused scan', async () => {
    const records = await artworkFixtures();
    const nextTitle = '扫描后保存的新标题';
    const keys = await Promise.all(
      records.map(
        async (record) => (await artLocation({ ...record, title: nextTitle }, 'stillwood', 3000)).key,
      ),
    );
    await Promise.all(keys.map((key) => put(key, 'image/jpeg')));
    const objects = (await scan(aged())).objects;
    expect(objects.every((object) => object.state === 'unused')).toBe(true);
    await env.DB.batch([
      env.DB.prepare('UPDATE episodes SET title = ?').bind(nextTitle),
      env.DB.prepare("UPDATE productions SET data = json_set(data, '$.title', ?)").bind(nextTitle),
    ]);
    const results = await remove(objects.map(({ key, version }) => ({ key, version })));
    expect(
      results.every((result) => result.status === 'skipped' && result.reason === '当前节目合成图片'),
    ).toBe(true);
    await Promise.all(keys.map(async (key) => expect(await env.MEDIA.head(key)).not.toBeNull()));
  });

  it('rechecks the saved theme on cleanup while keeping theme-independent share objects referenced', async () => {
    const records = await artworkFixtures();
    const squares = await Promise.all(
      records.map(async (record) => (await artLocation(record, 'stillwood')).key),
    );
    const shares = await Promise.all(records.map(async (record) => (await artLocation(record, null)).key));
    await Promise.all([...squares, ...shares].map((key) => put(key, 'image/jpeg')));
    const objects = (await scan(aged())).objects;
    expect(objects.every((object) => object.state === 'referenced')).toBe(true);
    await env.DB.prepare("UPDATE site_appearance SET theme = 'interval'").run();
    const results = await remove(objects.map(({ key, version }) => ({ key, version })));
    for (const key of squares) expect(results.find((result) => result.key === key)?.status).toBe('deleted');
    for (const key of shares) expect(results.find((result) => result.key === key)?.status).toBe('skipped');
  });

  it.each(['episodes', 'productions', 'appearance'] as const)(
    'fails closed when current rendered %s references cannot be read',
    async (resource) => {
      await artworkFixtures();
      const object = await put('rendered/unused/old.jpg', 'image/jpeg');
      const bindings = {
        ...aged(),
        DB: {
          batch: env.DB.batch.bind(env.DB),
          prepare: (sql: string) => {
            if (resource === 'appearance' && sql.startsWith('SELECT theme, version'))
              return { first: async () => null } as unknown as D1PreparedStatement;
            if (
              (resource === 'episodes' && sql.startsWith('SELECT e.id, e.title')) ||
              (resource === 'productions' && sql.startsWith('SELECT p.data, c.name'))
            )
              return { all: async () => ({ success: false, results: [] }) } as unknown as D1PreparedStatement;
            return env.DB.prepare(sql);
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
              body: JSON.stringify({ items: [{ key: object.key, version: object.version }] }),
            },
            bindings,
          )
        ).status,
      ).toBe(503);
      expect(await env.MEDIA.head(object.key)).not.toBeNull();
    },
  );

  it('does not delete when rendered reference revalidation becomes partial after cleanup begins', async () => {
    await artworkFixtures();
    const object = await put('rendered/unused/old.jpg', 'image/jpeg');
    let reads = 0;
    const bindings = {
      ...aged(),
      DB: {
        batch: env.DB.batch.bind(env.DB),
        prepare: (sql: string) => {
          if (sql.startsWith('SELECT p.data, c.name') && ++reads > 1)
            return { all: async () => ({ success: false, results: [] }) } as unknown as D1PreparedStatement;
          return env.DB.prepare(sql);
        },
      } as unknown as D1Database,
    };
    expect(await remove([{ key: object.key, version: object.version }], bindings)).toEqual([
      expect.objectContaining({ key: object.key, status: 'failed', bytes: 0 }),
    ]);
    expect(await env.MEDIA.head(object.key)).not.toBeNull();
  });

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
    await env.DB.prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, cover_url, category, status, created_at, updated_at, seo)
      VALUES ('seo-episode', 'seo-episode', 1, '节目', '', '', '/images/episode-01.webp', 'life', 'draft', 'now', 'now', ?)`)
      .bind(JSON.stringify({ ogImageUrl: `/media/${keys[3]}` }))
      .run();
    await env.DB.prepare(
      'INSERT INTO episode_mentions (episode_id, position, name, description, url) VALUES (?, 1, ?, ?, ?)',
    )
      .bind('seo-episode', '图片', '节目提及', `https://f.no.mt/${keys[5]}`)
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
    await Promise.all(keys.map((key) => put(key, 'image/png')));
    const objects = (await scan(aged())).objects;
    expect(objects).toHaveLength(keys.length);
    expect(objects.every((object) => object.state === 'referenced')).toBe(true);
    expect(
      (await remove(objects.map(({ key, version }) => ({ key, version })))).every(
        (result) => result.status === 'skipped',
      ),
    ).toBe(true);
    await Promise.all(keys.map(async (key) => expect(await env.MEDIA.head(key)).not.toBeNull()));
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

  it.each([
    ['/media/', '\n'],
    ['https://f.no.mt/', '\r\n'],
  ])(
    'revalidates saved slot media at %s followed by %j after first-save initialization',
    async (prefix, newline) => {
      const objects = await Promise.all([
        put('uploads/channel-slot-reference.webp'),
        put('uploads/category-slot-reference.webp'),
      ]);
      const staleScan = await scan(aged());
      expect(staleScan.objects.every((object) => object.state === 'unused')).toBe(true);
      const promptRequest = (path: string, method = 'GET', data?: unknown) =>
        worker.fetch(
          new Request(`${origin}/admin/api${path}`, {
            method,
            headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          }),
          env,
        );
      for (const [index, path] of ['/channel/prompt-slots', '/categories/life/prompt-slots'].entries()) {
        expect((await promptRequest(`${path}/migration/dry-run`)).status).toBe(404);
        const initialized = await promptRequest(path, 'PUT', {
          version: 0,
          slots: [
            {
              id: 'media-reference',
              title: 'Media reference',
              body: 'placeholder',
              order: 0,
              enabled: true,
              mode: 'override',
            },
          ],
        });
        expect(initialized.status).toBe(200);
        const updated = await promptRequest(path, 'PUT', {
          version: 1,
          slots: [
            {
              id: 'media-reference',
              title: 'Media reference',
              body: `${prefix}${objects[index].key}${newline}Next paragraph`,
              order: 0,
              enabled: index === 0,
              mode: 'append',
            },
          ],
        });
        expect(updated.status).toBe(200);
      }
      expect((await scan(aged())).objects.every((object) => object.state === 'referenced')).toBe(true);
      const results = await remove(staleScan.objects.map(({ key, version }) => ({ key, version })));
      expect(results.every((result) => result.status === 'skipped' && result.bytes === 0)).toBe(true);
      for (const object of objects) expect(await env.MEDIA.head(object.key)).not.toBeNull();
    },
  );

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
});
