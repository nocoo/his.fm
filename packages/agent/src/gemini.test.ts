import { AudioError } from '@his-fm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech } from './gemini.ts';

const AUDIO_MODEL = 'gemini-3.8-flash-tts';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
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
    const request = JSON.parse(fetcher.mock.calls[0]?.[1].body);
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
