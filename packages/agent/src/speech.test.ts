import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpeechSnapshot, wavHeader } from '@his-fm/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { elevenSpeech, generateSpeech } from './speech.ts';
import { testConfig } from './testing/fixtures.ts';

const input: SpeechSnapshot = {
  provider: 'elevenlabs',
  model: 'eleven_v4',
  voice: 'voice123',
  speakingStyle: '[calm]\nconversational',
  text: '你好，这里是 his.fm。',
  stability: 0.5,
  similarity: 0.75,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('uses the v4 supported parameters, bounds audio and never echoes upstream secrets', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(48000)));
  vi.stubGlobal('fetch', fetcher);
  const result = await elevenSpeech('private-key', input);
  expect(result.info.durationSeconds).toBe(1);
  const [url, request] = fetcher.mock.calls[0] ?? [];
  expect(url).toContain('output_format=pcm_24000');
  expect(request.redirect).toBe('error');
  expect(JSON.parse(request.body)).toEqual({
    text: '[calm  conversational] 你好，这里是 his.fm。',
    model_id: 'eleven_v4',
    language_code: 'zh',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    apply_text_normalization: 'auto',
  });
  await expect(elevenSpeech('', input)).rejects.toThrow('密钥');
  for (const status of [401, 429, 503]) {
    fetcher.mockResolvedValueOnce(new Response('private-key provider payload', { status }));
    await expect(elevenSpeech('private-key', input)).rejects.toThrow(`HTTP ${status}`);
  }
  fetcher.mockResolvedValueOnce(new Response(null));
  await expect(elevenSpeech('private-key', input)).rejects.toThrow('空音频');
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(16 * 1024 * 1024 + 1)));
  await expect(elevenSpeech('private-key', input)).rejects.toThrow('限制');
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(3)));
  await expect(elevenSpeech('private-key', input)).rejects.toThrow('大小');
});
it('caches valid native chunks, reuses completed audio and supports both providers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-speech-'));
  const config = testConfig(directory);
  config.speechKeys = { gemini: 'g', elevenlabs: 'e' };
  const fetcher = vi.fn().mockImplementation(async () => new Response(new Uint8Array(48000)));
  vi.stubGlobal('fetch', fetcher);
  try {
    const result = await generateSpeech(config, input, directory);
    expect(result.cached).toBe(false);
    expect(result.durationSeconds).toBe(1);
    expect((await generateSpeech(config, input, directory)).cached).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await rm(result.path);
    expect((await generateSpeech(config, input, directory)).cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await writeFile(result.path, 'bad');
    await expect(generateSpeech(config, input, directory)).rejects.toThrow('RIFF');
    const bytes = Buffer.concat([wavHeader(48000), new Uint8Array(48000)]);
    fetcher.mockResolvedValueOnce(
      Response.json({
        steps: [{ type: 'model_output', content: [{ type: 'audio', data: bytes.toString('base64') }] }],
      }),
    );
    const gemini = await generateSpeech(
      config,
      { ...input, provider: 'gemini', model: config.speech.gemini.model, voice: 'Kore' },
      directory,
    );
    expect((await readFile(gemini.path)).byteLength).toBe(48044);
    await expect(generateSpeech(config, { ...input, model: 'wrong' }, directory)).rejects.toThrow('模型');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
