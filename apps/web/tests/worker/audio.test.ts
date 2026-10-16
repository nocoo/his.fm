import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adoptProductionAudioUpload,
  PRODUCTION_AUDIO_MAX_BYTES,
  PRODUCTION_AUDIO_MAX_DURATION_SECONDS,
  parseAllowedProductionAudioKey,
  productionAudioObjectKey,
} from '../../worker/audio';

const goldenHeader =
  '524946462c00000057415645666d74201000000001000100c05d000080bb0000020010006461746108000000';

function fixture(samples = [1, 2, 3, 4]) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  bytes.set(Buffer.from(goldenHeader, 'hex'));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => {
    view.setInt16(44 + index * 2, value, true);
  });
  return bytes;
}

let miniflare: Miniflare;
let bucket: R2Bucket;

beforeAll(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'audio-test',
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
          env: { MEDIA: { type: 'r2', name: 'audio-test' } },
        },
      },
    ],
  });
  const storage = (await miniflare.getBindings<{ MEDIA: R2Bucket }>()).MEDIA;
  bucket = new Proxy(storage, {
    get(target, property) {
      if (property === 'put')
        return async (key: string, value: ReadableStream | Uint8Array, options: R2PutOptions) =>
          storage.put(
            key,
            value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value,
            options,
          );
      return Reflect.get(target, property);
    },
  });
}, 30000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await miniflare.dispose();
});

describe('production audio bind helpers', () => {
  it('accepts staging and attached keys for the same production', () => {
    const id = 'prod-1';
    expect(parseAllowedProductionAudioKey(id, 'uploads/00000000-0000-4000-8000-000000000001.wav')).toEqual({
      kind: 'staging',
    });
    expect(
      parseAllowedProductionAudioKey(
        id,
        productionAudioObjectKey(id, 2, '00000000-0000-4000-8000-000000000002'),
      ),
    ).toEqual({ kind: 'attached', scriptVersion: 2 });
    expect(() => parseAllowedProductionAudioKey(id, 'images/test.wav')).toThrow('路径无效');
    expect(() =>
      parseAllowedProductionAudioKey(
        id,
        productionAudioObjectKey('other', 2, '00000000-0000-4000-8000-000000000002'),
      ),
    ).toThrow('路径无效');
  });

  it('copies staging uploads into immutable production keys', async () => {
    const id = 'prod-copy';
    const staging = 'uploads/00000000-0000-4000-8000-000000000003.wav';
    await bucket.put(staging, fixture());
    const adopted = await adoptProductionAudioUpload(bucket, id, 1, staging);
    expect(adopted.key).toMatch(new RegExp(`^productions/${id}/audio-1-`));
    expect(await bucket.head(staging)).not.toBeNull();
    expect(adopted.stored.size).toBe(52);
  });

  it('preserves invalid sources and existing destinations when adoption fails', async () => {
    const staging = 'uploads/00000000-0000-4000-8000-000000000004.wav';
    await bucket.put(staging, new Uint8Array(44));
    const before = (await bucket.list()).objects.length;
    await expect(adoptProductionAudioUpload(bucket, 'invalid', 1, staging)).rejects.toThrow('RIFF WAV');
    expect(await bucket.head(staging)).not.toBeNull();
    expect((await bucket.list()).objects).toHaveLength(before);
    const uuid = '00000000-0000-4000-8000-000000000005';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    const existing = productionAudioObjectKey('invalid', 1, uuid);
    await bucket.put(existing, fixture());
    await expect(adoptProductionAudioUpload(bucket, 'invalid', 1, staging)).rejects.toThrow('已存在');
    expect(await bucket.head(existing)).not.toBeNull();
  });

  it('rejects out-of-band files beyond the shared upload size limit before copying', async () => {
    const cancel = vi.fn();
    const put = vi.fn();
    const oversized = {
      get: async () => ({ size: PRODUCTION_AUDIO_MAX_BYTES + 1, body: { cancel } }),
      put,
    } as unknown as R2Bucket;
    await expect(
      adoptProductionAudioUpload(oversized, 'large', 1, 'uploads/00000000-0000-4000-8000-000000000006.wav'),
    ).rejects.toThrow('大小');
    expect(cancel).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
  });

  it('uses a one-hour production narration limit', () => {
    expect(PRODUCTION_AUDIO_MAX_DURATION_SECONDS).toBe(3600);
    expect(PRODUCTION_AUDIO_MAX_BYTES).toBe(172_865_536);
    expect(2259.67).toBeLessThanOrEqual(PRODUCTION_AUDIO_MAX_DURATION_SECONDS);
  });
});
