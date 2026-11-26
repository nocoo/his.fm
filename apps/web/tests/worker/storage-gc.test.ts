import type { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { runStorageGc, STORAGE_GC_GRACE_MS, STORAGE_RETENTION_MS } from '../../worker/storage';
import {
  agedEnv,
  callStorage,
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

beforeAll(async () => {
  ({ mf, env } = await createStorageEnv('storage-gc-test'));
}, 30000);
beforeEach(async () => {
  cookie = await resetStorageEnv(env);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await mf.dispose();
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
    await Promise.all([put('unsafe.svg', 'image/svg+xml'), put('unknown')]);
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

  it('rejects storage uploads with unexpected query parameters', async () => {
    expect(
      (
        await call('?unexpected=1', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: new Uint8Array(44),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('?key=bad%20key&extra=1', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/mpeg' },
          body: new Uint8Array(10),
        })
      ).status,
    ).toBe(400);
  });

  it('scans references when prompt slot JSON is null', async () => {
    await env.DB.prepare(
      `INSERT INTO channel_profile (id, version, updated_at, updated_by, prompt_slots, prompt_slots_version)
       VALUES (1, 1, 'now', 'owner', NULL, 0)`,
    ).run();
    await env.DB.prepare("UPDATE categories SET prompt_slots=NULL WHERE id='life'").run();
    expect((await scan()).objects).toBeDefined();
  });

  it('rejects invalid storage scan cursors', async () => {
    expect((await call(`?cursor=${'x'.repeat(4097)}`)).status).toBe(400);
  });
});

describe('scheduled storage soft-retention GC', () => {
  it('auto-purges aged uploads after 24h and other unreferenced objects after the 7-day grace window', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const day0 = Date.parse('2026-11-01T03:00:00.000Z');
    const [oldUpload, freshUpload, detachedAudio, revivedAudio, protectedBrand] = await Promise.all([
      put('uploads/old-staging.png', 'image/png'),
      put('uploads/fresh-staging.png', 'image/png'),
      put('productions/p1/audio-1-old.mp3', 'audio/mpeg'),
      put('productions/p1/audio-2-revived.mp3', 'audio/mpeg'),
      put('images/hero-retina-20260926-1752.webp', 'image/webp'),
    ]);
    await env.DB.prepare('INSERT INTO storage_gc_queue (key, first_unreferenced_at) VALUES (?, ?)')
      .bind('already-deleted.wav', new Date(day0 - STORAGE_GC_GRACE_MS).toISOString())
      .run();

    const withUploadTimes = (times: Record<string, number>, base = env): Env => ({
      ...base,
      MEDIA: {
        head: async (key: string) => {
          const obj = await base.MEDIA.head(key);
          return obj ? { ...obj, uploaded: new Date(times[key] ?? day0 - 2 * STORAGE_RETENTION_MS) } : null;
        },
        list: async (options?: R2ListOptions) => {
          const page = await base.MEDIA.list(options);
          return {
            ...page,
            objects: page.objects.map((obj) => ({
              ...obj,
              uploaded: new Date(times[obj.key] ?? day0 - 2 * STORAGE_RETENTION_MS),
            })),
          };
        },
        delete: (key: string | string[]) => base.MEDIA.delete(key),
      } as R2Bucket,
    });

    const bindings = withUploadTimes({
      [freshUpload.key]: day0 - 1000,
    });

    const first = await runStorageGc(bindings, { nowMs: day0 });
    expect(first).toEqual({
      scanned: 5,
      enqueued: 2,
      dequeued: 1,
      deleted: 1,
      deletedBytes: 10,
      skipped: 0,
      failed: 0,
    });
    expect(await env.MEDIA.head(oldUpload.key)).toBeNull();
    expect(await env.MEDIA.head(freshUpload.key)).not.toBeNull();
    expect(await env.MEDIA.head(detachedAudio.key)).not.toBeNull();
    expect(await env.MEDIA.head(revivedAudio.key)).not.toBeNull();
    expect(await env.MEDIA.head(protectedBrand.key)).not.toBeNull();

    const scanned = (await scan(bindings)).objects;
    const queuedObj = scanned.find((obj) => obj.key === detachedAudio.key);
    expect(queuedObj?.purgeAfter).toBe(new Date(day0 + STORAGE_GC_GRACE_MS).toISOString());

    await env.DB.prepare("INSERT INTO media_provenance VALUES ('revived', ?)")
      .bind(JSON.stringify({ key: revivedAudio.key }))
      .run();

    const day3 = day0 + 3 * 24 * 60 * 60 * 1000;
    const mid = await runStorageGc(bindings, { nowMs: day3 });
    expect(mid.dequeued).toBe(1);
    expect(mid.deleted).toBe(1);
    expect(await env.MEDIA.head(freshUpload.key)).toBeNull();
    expect(await env.MEDIA.head(detachedAudio.key)).not.toBeNull();

    const day7 = day0 + STORAGE_GC_GRACE_MS;
    const final = await runStorageGc(bindings, { nowMs: day7 });
    expect(final.deleted).toBe(1);
    expect(final.deletedBytes).toBe(10);
    expect(await env.MEDIA.head(detachedAudio.key)).toBeNull();
    expect(await env.MEDIA.head(revivedAudio.key)).not.toBeNull();
    const leftover = await env.DB.prepare('SELECT key FROM storage_gc_queue').all();
    expect(leftover.results).toEqual([]);
  });

  it('revalidates before deleting, handles delete failures, and respects maxDeletes and environment', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const nowMs = Date.parse('2026-11-10T03:00:00.000Z');
    const dueIso = new Date(nowMs - STORAGE_GC_GRACE_MS - 1000).toISOString();
    const [skippedObj, failObj, deferredObj] = await Promise.all([
      put('productions/p2/01-skipped.mp3', 'audio/mpeg'),
      put('productions/p2/02-fail.mp3', 'audio/mpeg'),
      put('productions/p2/03-deferred.mp3', 'audio/mpeg'),
    ]);
    await env.DB.batch(
      [skippedObj, failObj, deferredObj].map((obj) =>
        env.DB.prepare('INSERT INTO storage_gc_queue (key, first_unreferenced_at) VALUES (?, ?)').bind(
          obj.key,
          dueIso,
        ),
      ),
    );
    const bindings = aged();
    const origHead = bindings.MEDIA.head;
    bindings.MEDIA.head = async (key: string) => {
      if (key === skippedObj.key) return null;
      return origHead(key);
    };
    const origDelete = bindings.MEDIA.delete;
    bindings.MEDIA.delete = async (key: string | string[]) => {
      if (key === failObj.key) throw new Error('R2 delete failed');
      return origDelete(key);
    };

    const summary = await runStorageGc(bindings, { nowMs, maxDeletes: 2 });
    expect(summary).toMatchObject({ scanned: 3, deleted: 0, skipped: 1, failed: 1 });
    expect(await env.MEDIA.head(deferredObj.key)).not.toBeNull();

    await worker.scheduled({} as ScheduledController, { ...bindings, ENVIRONMENT: 'local' });
    expect(await env.MEDIA.head(deferredObj.key)).not.toBeNull();

    await worker.scheduled({} as ScheduledController, { ...aged(), ENVIRONMENT: 'production' });
    expect(await env.MEDIA.head(deferredObj.key)).toBeNull();
  });
});
