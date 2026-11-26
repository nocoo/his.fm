import type { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoragePage } from '../../src/shared/storage';
import { readyFixture } from './production-fixture';
import {
  agedEnv,
  callStorage,
  cleanupStorage,
  createStorageEnv,
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
  ({ mf, env } = await createStorageEnv('storage-references-test'));
}, 30000);
beforeEach(async () => {
  cookie = await resetStorageEnv(env);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await mf.dispose();
});

describe('owner R2 reference resolution and pagination', () => {
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
      `INSERT INTO channel_profile (id, version, updated_at, updated_by, prompt_slots, prompt_slots_version) VALUES (1, 1, 'now', 'owner', ?, 1)`,
    )
      .bind(
        JSON.stringify([
          {
            id: 'positioning',
            title: '定位',
            body: 'https://f.no.mt/channel.webp',
            order: 0,
            enabled: true,
            mode: 'override',
            version: 1,
            updatedAt: 'now',
            updatedBy: 'owner',
          },
        ]),
      )
      .run();
    await env.DB.prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, lead, cover_url, category, status, created_at, updated_at)
      VALUES ('episode', 'episode', 1, '目录标题', '', '/media/transcript.wav', 'https://his.fm/media/notes.wav', 'https://f.no.mt/published.webp', 'life', 'draft', 'now', 'now')`).run();
    const puts: Promise<unknown>[] = [];
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
      puts.push(put(`audio/${production.id}/1/${id}/part-001.wav`), put(`bumper-${id}.wav`));
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
      'images/hero-retina-20260926-1752.webp',
      'images/episode-01.webp',
      'images/hero.webp',
      'images/brand/stillwood-master.png',
      'reference/voices/Kore.wav',
      'reference/voices/gemini-Kore.mp3',
      'not-ours.wav',
      'unused.mp4',
    ])
      puts.push(put(key));
    await Promise.all(puts);
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
    for (const key of [
      'images/hero-retina-20260926-1752.webp',
      'images/episode-01.webp',
      'reference/voices/gemini-Kore.mp3',
    ])
      expect(states[key]).toBe('protected');
    for (const key of [
      'images/hero.webp',
      'images/brand/stillwood-master.png',
      'reference/voices/Kore.wav',
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
    await Promise.all(
      protectedItems.map(async (object) => expect(await env.MEDIA.head(object.key)).not.toBeNull()),
    );
  });

  it('collects multiple references separated by CJK punctuation in prose', async () => {
    const imageKey = 'images/episode-01.webp';
    const uploadKey = 'uploads/cover.png';
    await env.DB.prepare(
      `INSERT INTO channel_profile (id, version, updated_at, updated_by, prompt_slots, prompt_slots_version) VALUES (1, 1, 'now', 'owner', ?, 1)`,
    )
      .bind(
        JSON.stringify([
          {
            id: 'positioning',
            title: '定位',
            body: `封面参考：/${imageKey}，备用图：https://f.no.mt/${uploadKey}`,
            order: 0,
            enabled: true,
            mode: 'override',
            version: 1,
            updatedAt: 'now',
            updatedBy: 'owner',
          },
        ]),
      )
      .run();
    await Promise.all([imageKey, uploadKey].map((key) => put(key, 'image/png')));
    const objects = (await scan(aged())).objects;
    const states = Object.fromEntries(objects.map((object) => [object.key, object.state]));
    expect(states[imageKey]).toBe('referenced');
    expect(states[uploadKey]).toBe('referenced');
    expect(states[`${uploadKey}?v=1`]).toBeUndefined();
    const cleanup = await remove(
      [imageKey, uploadKey].map((key) => {
        const object = objects.find((candidate) => candidate.key === key);
        expect(object).toBeDefined();
        return { key, version: object?.version ?? '' };
      }),
    );
    expect(cleanup.every((result) => result.status === 'skipped')).toBe(true);
  });

  it('strips query and fragment from relative media and image paths when resolving references', async () => {
    const mediaKey = 'uploads/ref-media-query.png';
    const imageKey = 'images/ref-image-fragment.webp';
    await env.DB.prepare(
      `INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, cover_url, category, seo, status, created_at, updated_at)
      VALUES ('seo-path', 'seo-path', 2, '路径引用', '', '', '', 'life', ?, 'draft', 'now', 'now')`,
    )
      .bind(
        JSON.stringify({
          ogImageUrl: `/media/${mediaKey}?v=2`,
          description: `备用 /${imageKey}#preview`,
        }),
      )
      .run();
    await Promise.all([mediaKey, imageKey].map((key) => put(key, 'image/png')));
    const objects = (await scan(aged())).objects;
    expect(objects.find((candidate) => candidate.key === mediaKey)?.state).toBe('referenced');
    expect(objects.find((candidate) => candidate.key === imageKey)?.state).toBe('referenced');
    expect(objects.some((candidate) => candidate.key.includes('?'))).toBe(false);
    expect(objects.some((candidate) => candidate.key.includes('#'))).toBe(false);
  });

  it('treats SEO image fields as referenced for site, category and episode scopes', async () => {
    const cdnKey = 'uploads/c457d853-8487-4c07-9346-7c9ee13cf024.png';
    const categoryKey = 'uploads/723aebb9-d547-4246-ac40-d0f758bb26c1.jpg';
    const episodeKey = 'uploads/episode-seo-only-share.jpg';
    const imagesKey = 'images/custom-og.webp';
    await env.DB.prepare(
      'UPDATE site_seo SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = 1',
    )
      .bind(
        JSON.stringify({
          defaultOgImageUrl: `/images/${imagesKey.split('/').pop()}`,
          podcastCoverUrl: `https://f.no.mt/${cdnKey}`,
        }),
        'now',
        'owner',
      )
      .run();
    await env.DB.prepare('UPDATE categories SET seo = ? WHERE id = ?')
      .bind(JSON.stringify({ ogImageUrl: `https://f.no.mt/${categoryKey}` }), 'life')
      .run();
    await env.DB.prepare(
      `INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, cover_url, category, seo, status, created_at, updated_at)
      VALUES ('episode', 'episode', 1, '节目元数据', '', '', '', 'life', ?, 'draft', 'now', 'now')`,
    )
      .bind(JSON.stringify({ ogImageUrl: `/media/${episodeKey}` }))
      .run();
    await Promise.all([cdnKey, categoryKey, episodeKey, imagesKey].map((key) => put(key, 'image/png')));
    const objects = (await scan(aged())).objects;
    const states = Object.fromEntries(objects.map((object) => [object.key, object.state]));
    for (const key of [cdnKey, categoryKey, episodeKey, imagesKey]) {
      expect(states[key]).toBe('referenced');
      expect(objects.find((object) => object.key === key)?.reasons.join('')).toMatch(/SEO/);
    }
    expect(objects.find((object) => object.key === episodeKey)?.reasons).toContain('节目 SEO：节目元数据');
    expect(objects.find((object) => object.key === categoryKey)?.reasons.join('')).toContain('栏目 SEO');
    const cleanup = await remove(
      [cdnKey, categoryKey, episodeKey, imagesKey].map((key) => {
        const object = objects.find((candidate) => candidate.key === key);
        expect(object).toBeDefined();
        return { key, version: object?.version ?? '' };
      }),
    );
    expect(cleanup.every((result) => result.status === 'skipped')).toBe(true);
  });

  it('keeps new uploads, rechecks references, detects replacement and reports individual failure', async () => {
    const fresh = await put('fresh.wav', 'audio/wav');
    expect((await scan()).objects[0]).toMatchObject({
      state: 'recent',
      kind: 'audio',
      contentType: 'audio/wav',
    });
    expect((await remove([{ key: fresh.key, version: fresh.version }], env))[0].status).toBe('skipped');
    const [used, replaced, gone, failed, disposable] = await Promise.all([
      put('new-reference.wav'),
      put('replaced.png'),
      put('gone.mp4'),
      put('failed.mp4'),
      put('disposable.mp4'),
    ]);
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
