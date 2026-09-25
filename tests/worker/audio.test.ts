import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_MODEL,
  AudioError,
  chunkTranscript,
  composeWav,
  parseWav,
  readStoredWav,
  synthesizeSpeech,
  wavHeader,
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

function edited(offset: number, value: number, width = 2) {
  const bytes = fixture();
  const view = new DataView(bytes.buffer);
  if (width === 4) view.setUint32(offset, value, true);
  else view.setUint16(offset, value, true);
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
          type: 'worker',
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

describe('exact transcript segmentation', () => {
  it('preserves every code point and prefers sentence boundaries', () => {
    const text = `${'今晚先聊一件小事。\n给自己留一点时间！'.repeat(100)}🌱`;
    const chunks = chunkTranscript(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 420)).toBe(true);
    expect(chunks[0].at(-1)).toMatch(/[。！\n]/);
    expect(chunkTranscript('甲'.repeat(421)).map((chunk) => chunk.length)).toEqual([420, 1]);
    expect(chunkTranscript('🌱🌱🌱', 2)).toEqual(['🌱🌱', '🌱']);
  });

  it('rejects empty scripts and invalid chunk limits', () => {
    expect(() => chunkTranscript(' \n ')).toThrow('不能为空');
    for (const maximum of [0, -1, 0.5, 421, Number.NaN]) {
      expect(() => chunkTranscript('text', maximum)).toThrow('长度');
    }
  });
});

describe('bounded PCM WAV parsing', () => {
  it('reads a standard WAV and creates the expected RIFF header', () => {
    expect(parseWav(fixture())).toEqual({
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      blockAlign: 2,
      dataOffset: 44,
      dataBytes: 8,
      durationSeconds: 1 / 6000,
    });
    expect(Buffer.from(wavHeader(8)).toString('hex')).toBe(goldenHeader);
    expect(parseWav(fixture().slice(0, 44), 52).dataBytes).toBe(8);
  });

  it('skips unknown odd-length chunks with their padding', () => {
    const original = fixture();
    const bytes = new Uint8Array(original.length + 12);
    bytes.set(original.subarray(0, 36));
    bytes.set(new TextEncoder().encode('JUNK'), 36);
    new DataView(bytes.buffer).setUint32(40, 3, true);
    bytes.set([1, 2, 3, 0], 44);
    bytes.set(original.subarray(36), 48);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    expect(parseWav(bytes).dataOffset).toBe(56);
  });

  it('rejects invalid files and incomplete RIFF structures', () => {
    for (const bytes of [new Uint8Array(), new TextEncoder().encode('NOT A WAVE FILE'), edited(8, 0)]) {
      expect(() => parseWav(bytes)).toThrow('RIFF WAV');
    }
    expect(() => parseWav(edited(4, 1000, 4))).toThrow('不完整');
    expect(() => parseWav(edited(4, 10, 4))).toThrow('不完整');
    expect(() => parseWav(edited(40, 1000, 4))).toThrow('边界');
    expect(() => parseWav(edited(16, 10, 4))).toThrow('格式段不完整');
    expect(() => parseWav(fixture().slice(0, 25), 52)).toThrow('格式段不完整');
    expect(() => parseWav(fixture().slice(0, 36), 52)).toThrow('缺少音频数据');
    expect(() => parseWav(edited(40, 7, 4))).toThrow('数据或格式');
    expect(() => parseWav(edited(40, 0, 4))).toThrow('数据或格式');
    const noFormat = fixture();
    noFormat.set(new TextEncoder().encode('JUNK'), 12);
    expect(() => parseWav(noFormat)).toThrow('数据或格式');
  });

  it('rejects formats that would produce corrupt concatenated audio', () => {
    for (const [offset, value, width] of [
      [20, 3, 2],
      [22, 2, 2],
      [24, 44100, 4],
      [28, 42, 4],
      [32, 4, 2],
      [34, 24, 2],
    ]) {
      expect(() => parseWav(edited(offset, value, width))).toThrow('24 kHz');
    }
    for (const bytes of [0, 1, -2, 1.5, 0xffffffff, Number.NaN]) {
      expect(() => wavHeader(bytes)).toThrow('大小无效');
    }
  });
});

describe('Gemini 3.8 Interactions requests', () => {
  function reply(value: unknown) {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(value)));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }

  const audio = { type: 'audio', data: Buffer.from(fixture()).toString('base64') };

  it('submits exactly the approved words and decodes a complete WAV', async () => {
    const text = '今晚，我们慢慢说。\n没有多余的开场白。';
    const fetcher = reply({ id: 'interaction-1', steps: [{ type: 'model_output', content: [audio] }] });
    const result = await synthesizeSpeech('test-key', text, 'Kore', 'Warm and conversational.');
    expect(result.bytes).toEqual(fixture());
    expect(result.interactionId).toBe('interaction-1');
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.model).toBe(AUDIO_MODEL);
    expect(request.input[0].content[0].text).toBe(text);
    expect(request.generation_config.speech_config).toEqual([{ voice: 'Kore' }]);
    expect(request.response_format).toEqual({ type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 });
    reply({ steps: [{ type: 'model_output', content: [audio] }] });
    expect(
      (await synthesizeSpeech('test-key', text, 'Kore', 'Warm and conversational.')).interactionId,
    ).toBeNull();
  });

  it('requires a secret and a bounded transcript before any request', async () => {
    const fetcher = reply({});
    await expect(synthesizeSpeech('', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow('密钥');
    await expect(
      synthesizeSpeech('key', '甲'.repeat(421), 'Kore', 'Warm and conversational.'),
    ).rejects.toThrow('420');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies provider errors without exposing response details or secrets', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const status of [400, 429, 503]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive details', { status })));
      try {
        await synthesizeSpeech('test-key', '你好', 'Kore', 'Warm and conversational.');
      } catch (error) {
        expect(error).toBeInstanceOf(AudioError);
        expect(error).toMatchObject({ retryable: status !== 400 });
        expect(String(error)).not.toContain('sensitive');
        expect(String(error)).not.toContain('test-key');
      }
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow('403');
  });

  it('reports actionable provider categories without echoing their raw messages', async () => {
    const logs = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases = [
      ['User location is not supported for the API use.', '服务出口地区'],
      ['Free tier is not available in your country.', '开通计费'],
      ['Billing must be enabled.', '开通计费'],
      ['API key not valid. Please pass a valid API key.', '密钥无效'],
      ['Voice UnsupportedExample is not supported.', '不支持当前音色'],
      ['Unknown field in request.', '语音参数'],
    ];
    for (const [message, expected] of cases) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error: { status: 'INVALID_ARGUMENT', message: `${message} secret-test-key` } },
              { status: 400 },
            ),
          ),
      );
      await expect(synthesizeSpeech('secret-test-key', '你好', 'Kore', 'Warm')).rejects.toThrow(expected);
    }
    expect(JSON.stringify(logs.mock.calls)).not.toContain('secret-test-key');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('UnsupportedExample');
    for (const error of [null, { message: 42 }, { status: 'UNKNOWN' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error }, { status: 400 })));
      await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm')).rejects.toThrow('HTTP 400');
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(8193), { status: 400 })));
    await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm')).rejects.toThrow('HTTP 400');
  });

  it('rejects invalid JSON, absent bodies, and unsafe response sizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{')));
    await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow('JSON');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
    await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow(
      '空响应',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(16 * 1024 * 1024 + 1))));
    await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow(
      '大小限制',
    );
  });

  it('requires one complete valid audio output while ignoring non-audio steps', async () => {
    for (const value of [null, 'text', {}, { steps: null }]) {
      reply(value);
      await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow(
        '结构',
      );
    }
    for (const steps of [
      [],
      [null, { type: 'other' }, { type: 'model_output', content: [null, { type: 'text' }] }],
      [{ type: 'model_output', content: [audio, audio] }],
      [{ type: 'model_output', content: [{ type: 'audio' }] }],
    ]) {
      reply({ steps });
      await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow(
        '唯一完整音频',
      );
    }
    reply({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: '%%%bad' }] }] });
    await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow('编码');
    reply({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: 'aGVsbG8=' }] }] });
    await expect(synthesizeSpeech('key', '你好', 'Kore', 'Warm and conversational.')).rejects.toThrow('RIFF');
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
