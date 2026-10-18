import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { putR2Fixture, r2FixtureWorker } from './r2-fixtures';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let runtime: Miniflare;
let bucket: R2Bucket;

beforeAll(async () => {
  runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'r2-fixtures-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: { 'index.js': { type: 'esm', contents: r2FixtureWorker } },
          },
          env: { MEDIA: { type: 'r2', name: 'r2-fixtures-test' } },
        },
      },
    ],
  });
  bucket = (await runtime.getBindings<{ MEDIA: R2Bucket }>()).MEDIA;
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => runtime.dispose());

it('streams oversized byte views with their exact length, contents and object key', async () => {
  const backing = Buffer.alloc(20_000_003, 0xa5);
  backing[0] = 0;
  backing[backing.length - 1] = 0;
  const bytes = backing.subarray(1, -1);
  const key = 'fixtures/oversized ?#%封面.bin';
  await putR2Fixture(runtime, key, bytes);
  const object = await bucket.get(key);
  if (!object) throw new Error('Missing fixture');
  const stored = Buffer.from(await new Response(object.body).arrayBuffer());
  expect(object.size).toBe(20_000_001);
  expect(stored.equals(bytes)).toBe(true);
});

it('consumes and rejects unsuccessful fixture responses', async () => {
  const response = new MiniflareResponse('storage rejected', { status: 500 });
  vi.spyOn(runtime, 'dispatchFetch').mockResolvedValueOnce(response);
  await expect(putR2Fixture(runtime, 'failed.bin', new Uint8Array([1]))).rejects.toThrow(
    'R2 fixture upload failed (500): storage rejected',
  );
  expect(response.bodyUsed).toBe(true);
  expect(await bucket.head('failed.bin')).toBeNull();
});
