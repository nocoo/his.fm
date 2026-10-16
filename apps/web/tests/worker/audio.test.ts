import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  adoptProductionAudioUpload,
  composeWav,
  parseAllowedProductionAudioKey,
  productionAudioObjectKey,
  readStoredWav,
  wavStream,
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

function fixedLengthStream() {
  vi.stubGlobal(
    'FixedLengthStream',
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(length: number) {
        let received = 0;
        super({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > length) throw new Error('Too many bytes');
            controller.enqueue(chunk);
          },
          flush() {
            if (received !== length) throw new Error('Missing bytes');
          },
        });
      }
    },
  );
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
  bucket = (await miniflare.getBindings<{ MEDIA: R2Bucket }>()).MEDIA;
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
    expect(await bucket.head(staging)).toBeNull();
    expect(adopted.stored.size).toBe(52);
  });
});

describe('R2 streaming composition', () => {
  it('reads bounded headers and streams intro, narration and outro in exact sample order', async () => {
    await bucket.put('intro.wav', fixture([10, 11]));
    await bucket.put('narration.wav', fixture([20, 21, 22]));
    await bucket.put('outro.wav', fixture([30, 31]));
    const parts = await Promise.all(
      ['intro.wav', 'narration.wav', 'outro.wav'].map((key) => readStoredWav(bucket, key)),
    );
    const bytes = new Uint8Array(await new Response(wavStream(bucket, parts)).arrayBuffer());
    expect(bytes).toEqual(fixture([10, 11, 20, 21, 22, 30, 31]));
    expect(parts[0]).toMatchObject({ key: 'intro.wav', size: 48, dataBytes: 4 });
    await expect(readStoredWav(bucket, 'missing.wav')).rejects.toThrow('不存在');
  });

  it('fails when a source has changed after its header was inspected', async () => {
    await bucket.put('changed.wav', fixture([1, 2]));
    const part = await readStoredWav(bucket, 'changed.wav');
    await bucket.put('changed.wav', fixture([3, 4]));
    await expect(new Response(wavStream(bucket, [part])).arrayBuffer()).rejects.toThrow('发生变化');
    await bucket.delete('changed.wav');
    await expect(new Response(wavStream(bucket, [part])).arrayBuffer()).rejects.toThrow('发生变化');
  });

  it('detects short and oversized range responses', async () => {
    await bucket.put('range.wav', fixture([1, 2]));
    const part = await readStoredWav(bucket, 'range.wav');
    const object = await bucket.get('range.wav');
    if (!object) throw new Error('Fixture missing');
    for (const length of [2, 6]) {
      const malformed = new Proxy(bucket, {
        get(target, property) {
          if (property === 'get')
            return async () => ({ ...object, body: new Response(new Uint8Array(length)).body });
          return Reflect.get(target, property);
        },
      });
      await expect(new Response(wavStream(malformed, [part])).arrayBuffer()).rejects.toThrow(
        length === 2 ? '不完整' : '超出声明',
      );
    }
  });

  it('allows consumers to cancel while a source is active', async () => {
    await bucket.put('cancel.wav', fixture([1, 2]));
    const part = await readStoredWav(bucket, 'cancel.wav');
    const reader = wavStream(bucket, [part]).getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();
    const early = wavStream(bucket, [part]).getReader();
    await early.cancel();
  });

  it('writes a complete composed object with immutable metadata', async () => {
    fixedLengthStream();
    await bucket.put('compose.wav', fixture([1, 2]));
    const storage = new Proxy(bucket, {
      get(target, property) {
        if (property === 'put')
          return async (key: string, value: ReadableStream, options: R2PutOptions) => {
            const bytes = await new Response(value).arrayBuffer();
            return bucket.put(key, bytes, options);
          };
        return Reflect.get(target, property);
      },
    });
    const result = await composeWav(storage, ['compose.wav', 'compose.wav'], 'jobs/test/final.wav');
    expect(result).toEqual({ key: 'jobs/test/final.wav', bytes: 52, durationSeconds: 1 / 6000 });
    const object = await bucket.get('jobs/test/final.wav');
    expect(object?.httpMetadata?.contentType).toBe('audio/wav');
    if (!object) throw new Error('Composed object missing');
    expect(new Uint8Array(await object.arrayBuffer())).toEqual(fixture([1, 2, 1, 2]));
  });

  it('cancels stream production when R2 rejects an upload', async () => {
    fixedLengthStream();
    await bucket.put('failure.wav', fixture([1, 2]));
    const unavailable = new Proxy(bucket, {
      get(target, property) {
        if (property === 'put')
          return async () => {
            throw new Error('storage unavailable');
          };
        return Reflect.get(target, property);
      },
    });
    await expect(composeWav(unavailable, ['failure.wav'], 'failed.wav')).rejects.toThrow(
      'storage unavailable',
    );
  });
});
