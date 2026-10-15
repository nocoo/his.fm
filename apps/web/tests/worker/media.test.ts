import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { byteRange, streamMedia } from '../../worker/media';

let mf: Miniflare;
let env: Env;
const bytes = '0123456789';
const key = 'productions/example/audio.wav';
const call = (headers: Record<string, string | undefined> = {}, method = 'GET', bindings = env) =>
  worker.fetch(
    new Request(`https://his.fm/media/${key}`, {
      method,
      headers: Object.entries(headers).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
    }),
    bindings,
  );
beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'media-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: { MEDIA: { type: 'r2', name: 'media-test' } },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'audio/wav' } });
});
afterAll(() => mf.dispose());

it('streams full GET and HEAD with exact lengths and stable conditional validators', async () => {
  const response = await call();
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Length')).toBe('10');
  expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  expect(response.headers.get('Content-Type')).toBe('audio/wav');
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
  expect(await response.text()).toBe(bytes);
  const etag = response.headers.get('ETag') ?? '';
  const date = response.headers.get('Last-Modified') ?? '';
  const head = await call({ Range: 'bytes=0-1' }, 'HEAD');
  expect(head.status).toBe(200);
  expect(head.headers.get('Content-Length')).toBe('10');
  expect(head.headers.has('Content-Range')).toBe(false);
  expect(await head.text()).toBe('');
  for (const headers of [
    { 'If-None-Match': etag },
    { 'If-None-Match': `W/${etag}` },
    { 'If-None-Match': '*' },
    { 'If-None-Match': `"other", ${etag}` },
    { 'If-Modified-Since': date },
  ])
    for (const method of ['GET', 'HEAD']) {
      const unchanged = await call(headers, method);
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get('ETag')).toBe(etag);
      expect(unchanged.headers.has('Content-Length')).toBe(false);
      expect(await unchanged.text()).toBe('');
    }
  for (const headers of [
    { 'If-None-Match': '"other"', 'If-Modified-Since': date },
    { 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
    { 'If-Modified-Since': 'invalid' },
    { 'If-Match': etag },
    { 'If-Match': '*' },
    { 'If-Match': `W/"other", ${etag}` },
    { 'If-Match': etag, 'If-Unmodified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
    { 'If-Unmodified-Since': date },
  ])
    expect(await (await call(headers)).text()).toBe(bytes);
  for (const headers of [
    { 'If-Match': '"other"' },
    { 'If-Match': `W/${etag}` },
    { 'If-Unmodified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
  ])
    expect((await call(headers)).status).toBe(412);
});

it('supports closed, open and suffix byte ranges and exact If-Range validators', async () => {
  const object = await env.MEDIA.head(key);
  if (!object) throw new Error('Missing fixture');
  for (const [range, expected, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=0-999', bytes, 'bytes 0-9/10'],
    ['bytes=-999', bytes, 'bytes 0-9/10'],
  ]) {
    const response = await call({ Range: range });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(contentRange);
    expect(response.headers.get('Content-Length')).toBe(String(expected.length));
    expect(await response.text()).toBe(expected);
  }
  for (const validator of [object.httpEtag, object.uploaded.toUTCString()]) {
    const response = await call({ Range: 'bytes=2-5', 'If-Range': validator });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('2345');
  }
  for (const validator of [
    '"different"',
    `W/${object.httpEtag}`,
    'Thu, 01 Jan 1970 00:00:00 GMT',
    'invalid',
  ]) {
    const response = await call({ Range: 'bytes=2-5', 'If-Range': validator });
    expect(response.status).toBe(200);
    expect(response.headers.has('Content-Range')).toBe(false);
    expect(await response.text()).toBe(bytes);
  }
  expect((await call({ Range: 'bytes=2-5', 'If-None-Match': object.httpEtag })).status).toBe(304);
});

it('rejects invalid or unsatisfiable ranges without returning an entire file', async () => {
  for (const range of [
    'bytes=99-',
    'bytes=5-2',
    'bytes=-0',
    'bytes=-',
    'bytes=1-2,4-5',
    'items=0-1',
    'bytes=99999999999999999-',
  ]) {
    const response = await call({ Range: range });
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */10');
    expect(await response.text()).toBe('');
  }
  expect(byteRange('bytes=0-', 0)).toBeNull();
  expect(byteRange('bytes=0-0', 10)).toEqual({ offset: 0, length: 1 });
  expect((await call(undefined, 'POST')).status).toBe(405);
  expect((await worker.fetch(new Request('https://his.fm/media/missing.wav'), env)).status).toBe(404);
});

it('fences ranged reads against replacement or deletion after metadata inspection', async () => {
  const object = await env.MEDIA.head(key);
  if (!object) throw new Error('Missing fixture');
  const request = new Request(`https://his.fm/media/${key}`, { headers: { Range: 'bytes=0-2' } });
  const get = vi.fn(async () => null);
  await expect(
    streamMedia(request, { get } as unknown as R2Bucket, object, new Headers()),
  ).rejects.toMatchObject({ status: 409 });
  get.mockResolvedValueOnce(object as never);
  await expect(
    streamMedia(request, { get } as unknown as R2Bucket, object, new Headers()),
  ).rejects.toMatchObject({ status: 409 });
  expect(get).toHaveBeenCalledWith(key, {
    range: { offset: 0, length: 3 },
    onlyIf: { etagMatches: object.etag },
  });
});
