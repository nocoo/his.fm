import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  AudioError,
  chunkTranscript,
  parseWav,
  type SpeechSnapshot,
  speechCacheContent,
  wavHeader,
} from '@his-fm/contracts';
import type { Config } from './config.ts';
import { synthesizeSpeech } from './gemini.ts';

export async function elevenSpeech(key: string, input: SpeechSnapshot) {
  if (!key) throw new AudioError('尚未配置 ElevenLabs API 密钥');
  const style = input.speakingStyle.replace(/[[\]\r\n]/g, ' ').trim();
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voice)}?output_format=pcm_24000`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
      redirect: 'error',
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        text: `[${style}] ${input.text}`,
        model_id: 'eleven_v4',
        language_code: 'zh',
        voice_settings: { stability: input.stability, similarity_boost: input.similarity },
        apply_text_normalization: 'auto',
      }),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new AudioError(
      `ElevenLabs 语音请求失败（HTTP ${response.status}），请检查权限、额度和音色。`,
      response.status === 429 || response.status >= 500,
    );
  }
  if (!response.body) throw new AudioError('ElevenLabs 返回空音频');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16 * 1024 * 1024) throw new AudioError('ElevenLabs 音频超出分段限制');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = Buffer.concat([wavHeader(length), ...chunks]);
  return { bytes, info: parseWav(bytes) };
}

export async function generateSpeech(config: Config, input: SpeechSnapshot, directory: string) {
  if (input.model !== config.speech[input.provider].model) throw new AudioError('语音模型与配置不一致');
  const hash = createHash('sha256').update(speechCacheContent(input)).digest('hex');
  const path = `${directory}/${hash}.wav`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const bytes = await readFile(path);
    return { path, ...parseWav(bytes), hash, cached: true };
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const parts: Uint8Array[] = [];
  const chunks = chunkTranscript(input.text);
  let size = 0;
  for (let index = 0; index < chunks.length; index++) {
    const partPath = `${directory}/${hash}-${index}.wav`;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(partPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const text = chunks[index];
      if (!text) throw new AudioError('语音分段无效');
      const generated =
        input.provider === 'gemini'
          ? await synthesizeSpeech(config.speechKeys.gemini, text, input.voice, input.speakingStyle)
          : await elevenSpeech(config.speechKeys.elevenlabs, { ...input, text });
      bytes = generated.bytes;
      await writeFile(`${partPath}.tmp`, bytes, { mode: 0o600 });
      await rename(`${partPath}.tmp`, partPath);
    }
    const info = parseWav(bytes);
    size += info.dataBytes;
    if (size > 1800 * 24000 * 2) throw new AudioError('音频不能超过 30 分钟');
    parts.push(bytes.subarray(info.dataOffset, info.dataOffset + info.dataBytes));
  }
  const bytes = Buffer.concat([wavHeader(size), ...parts]);
  await writeFile(`${path}.tmp`, bytes, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return { path, ...parseWav(bytes), hash, cached: false };
}
