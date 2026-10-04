import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpeechSnapshot } from '@his-fm/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { WebsiteClient } from './client.ts';
import { runSpeech, speechCli } from './speech-cli.ts';
import { runSpeechJob } from './speech-job.ts';
import { testConfig } from './testing/fixtures.ts';

const run = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(() => {}, { [promisify.custom]: run }) };
});
const input: SpeechSnapshot = {
  provider: 'gemini',
  model: 'gemini-3.8-flash-tts',
  voice: 'Kore',
  speakingStyle: 'calm',
  text: '你好',
  stability: 0.5,
  similarity: 0.75,
};
afterEach(() => {
  vi.restoreAllMocks();
  run.mockReset();
});
it('runs an immutable job in a bounded secret-free child and uploads only its generated file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-job-'));
  const config = testConfig(directory);
  const client = new WebsiteClient(config.websites.local);
  const speech = vi.spyOn(client, 'speech');
  try {
    const receipt = { complete: true, result: { url: '/media/preview.wav' } };
    speech.mockResolvedValueOnce(receipt);
    expect(
      await runSpeechJob(
        client,
        () => 'generation',
        'job',
        'speech:job:one',
        directory,
        new AbortController().signal,
      ),
    ).toEqual(receipt);
    expect(run).not.toHaveBeenCalled();
    speech
      .mockReset()
      .mockResolvedValueOnce({ input })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(receipt);
    const audio = join(directory, 'generated.wav');
    await writeFile(audio, 'test-audio');
    run.mockResolvedValueOnce({ stdout: JSON.stringify({ path: audio }) });
    expect(
      await runSpeechJob(
        client,
        () => 'generation',
        'job',
        'speech:job:one',
        directory,
        new AbortController().signal,
      ),
    ).toEqual(receipt);
    expect(JSON.parse(await readFile(join(directory, 'speech-request.json'), 'utf8'))).toEqual(input);
    expect(speech).toHaveBeenLastCalledWith(
      'job',
      'speech:job:one',
      'generation',
      'PUT',
      Buffer.from('test-audio'),
    );
    const options = run.mock.calls[0]?.[2];
    expect(options.timeout).toBe(1800000);
    expect(Object.keys(options.env)).toEqual(expect.arrayContaining(['PATH', 'HOME']));
    expect(JSON.stringify(options.env)).not.toContain('fake-site-key');
    speech.mockReset().mockResolvedValueOnce({ input }).mockResolvedValue({});
    run.mockRejectedValueOnce(new Error('private upstream detail'));
    await expect(
      runSpeechJob(client, () => 'g', 'job', 'speech:job:one', directory, new AbortController().signal),
    ).rejects.toThrow('脚本失败');
    expect(speech).toHaveBeenLastCalledWith('job', 'speech:job:one', 'g', 'DELETE');
    const controller = new AbortController();
    controller.abort();
    speech.mockReset().mockResolvedValueOnce({ input }).mockResolvedValue({});
    run.mockRejectedValueOnce(new Error('aborted'));
    await expect(
      runSpeechJob(client, () => 'g', 'job', 'speech:job:one', directory, controller.signal),
    ).rejects.toThrow('脚本失败');
    expect(speech.mock.calls.some((args) => args[3] === 'DELETE')).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('loads only typed local jobs and sanitizes CLI errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-cli-'));
  const path = join(directory, 'job.json');
  await writeFile(path, JSON.stringify(input));
  const generateSpeech = vi.fn(async () => ({
    path: 'audio.wav',
    durationSeconds: 1,
    hash: 'h',
    cached: false,
    sampleRate: 24000,
    channels: 1,
    bitsPerSample: 16,
    blockAlign: 2,
    dataOffset: 44,
    dataBytes: 48000,
  }));
  const config = testConfig();
  try {
    await expect(runSpeech([])).rejects.toThrow('路径');
    await expect(runSpeech(['a', 'b'])).rejects.toThrow('路径');
    expect(
      (await runSpeech([path], { loadConfig: async () => config, generateSpeech }, directory)).path,
    ).toBe('audio.wav');
    expect(generateSpeech).toHaveBeenCalledWith(config, input, directory);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = { exitCode: 0 } as typeof process;
    await speechCli([path], async () => generateSpeech(), host);
    expect(log).toHaveBeenCalledOnce();
    await speechCli(
      [path],
      async () => {
        throw new Error('private-key');
      },
      host,
    );
    expect(host.exitCode).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-key');
    await writeFile(path, '{}');
    await expect(
      runSpeech([path], { loadConfig: async () => config, generateSpeech }, directory),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('binds native speech requests to station generation and command without revealing HTTP errors', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ complete: true }));
  const client = new WebsiteClient(testConfig().websites.local, request);
  expect(await client.speech('job', 'command', 'g')).toEqual({ complete: true });
  expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
    'X-Hisfm-Generation': 'g',
    'X-Hisfm-Command': 'command',
  });
  request.mockResolvedValueOnce(new Response('private response', { status: 403 }));
  await expect(client.speech('j', 'c', 'g', 'PUT', new Uint8Array([1]))).rejects.toThrow('403');
  request.mockRejectedValueOnce(new Error('private network'));
  await expect(client.speech('j', 'c', 'g')).rejects.toThrow('传输失败');
});
