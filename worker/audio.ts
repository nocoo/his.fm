export const AUDIO_MODEL = 'gemini-3.8-flash-tts';
export const AUDIO_SAMPLE_RATE = 24_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const HEADER_SCAN_BYTES = 64 * 1024;

export class AudioError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AudioError';
  }
}

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataBytes: number;
  durationSeconds: number;
};

export type StoredWav = WavInfo & { key: string; etag: string; size: number };

export function chunkTranscript(transcript: string, maximum = 420): string[] {
  if (!transcript.trim()) throw new AudioError('逐字稿不能为空');
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 420) {
    throw new AudioError('语音分段长度必须在 1 到 420 字符之间');
  }
  const characters = Array.from(transcript);
  const chunks: string[] = [];
  let offset = 0;
  while (offset < characters.length) {
    let end = Math.min(offset + maximum, characters.length);
    if (end < characters.length) {
      const minimum = offset + Math.floor(maximum / 2);
      for (let index = end - 1; index >= minimum; index--) {
        if (/[。！？.!?\n]/.test(characters[index])) {
          end = index + 1;
          break;
        }
      }
    }
    chunks.push(characters.slice(offset, end).join(''));
    offset = end;
  }
  return chunks;
}

export function parseWav(bytes: Uint8Array, fileSize = bytes.byteLength): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = (offset: number) => new TextDecoder().decode(bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || label(0) !== 'RIFF' || label(8) !== 'WAVE') {
    throw new AudioError('音频必须是 RIFF WAV 文件');
  }
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd > fileSize || riffEnd < 44) throw new AudioError('WAV 文件不完整');
  let format: Omit<WavInfo, 'dataOffset' | 'dataBytes' | 'durationSeconds'> | undefined;
  for (let offset = 12; offset + 8 <= Math.min(bytes.length, riffEnd); ) {
    const type = label(offset);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > riffEnd) throw new AudioError('WAV 数据段超出文件边界');
    if (type === 'fmt ') {
      if (length < 16 || start + 16 > bytes.length) throw new AudioError('WAV 格式段不完整');
      const encoding = view.getUint16(start, true);
      const channels = view.getUint16(start + 2, true);
      const sampleRate = view.getUint32(start + 4, true);
      const byteRate = view.getUint32(start + 8, true);
      const blockAlign = view.getUint16(start + 12, true);
      const bitsPerSample = view.getUint16(start + 14, true);
      if (
        encoding !== 1 ||
        channels !== 1 ||
        sampleRate !== AUDIO_SAMPLE_RATE ||
        bitsPerSample !== 16 ||
        blockAlign !== 2 ||
        byteRate !== AUDIO_SAMPLE_RATE * 2
      ) {
        throw new AudioError('请使用 24 kHz、单声道、16-bit PCM WAV 音频');
      }
      format = { channels, sampleRate, bitsPerSample, blockAlign };
    }
    if (type === 'data') {
      if (!format || length === 0 || length % format.blockAlign !== 0) {
        throw new AudioError('WAV 音频数据或格式无效');
      }
      return {
        ...format,
        dataOffset: start,
        dataBytes: length,
        durationSeconds: length / (format.sampleRate * format.blockAlign),
      };
    }
    offset = start + length + (length % 2);
  }
  throw new AudioError('WAV 缺少音频数据，或文件头超出允许大小');
}

export function wavHeader(dataBytes: number): Uint8Array {
  if (!Number.isSafeInteger(dataBytes) || dataBytes < 2 || dataBytes % 2 || dataBytes > 0xffffffff - 36) {
    throw new AudioError('合成音频大小无效');
  }
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const encoder = new TextEncoder();
  header.set(encoder.encode('RIFF'), 0);
  view.setUint32(4, dataBytes + 36, true);
  header.set(encoder.encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  header.set(encoder.encode('data'), 36);
  view.setUint32(40, dataBytes, true);
  return header;
}

export async function readStoredWav(bucket: R2Bucket, key: string): Promise<StoredWav> {
  const object = await bucket.get(key, { range: { offset: 0, length: HEADER_SCAN_BYTES } });
  if (!object) throw new AudioError(`音频素材不存在：${key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { ...parseWav(bytes, object.size), key, etag: object.etag, size: object.size };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AudioError('语音服务返回空响应');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new AudioError('语音服务响应超出分段大小限制');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AudioError('语音服务返回无效 JSON');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function synthesizeSpeech(apiKey: string, text: string, voice: string, speakingStyle: string) {
  if (!apiKey) throw new AudioError('尚未配置 Gemini API 密钥');
  if (chunkTranscript(text).length !== 1) throw new AudioError('语音分段超过 420 字符');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: AUDIO_MODEL,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text,
              annotations: [{ type: 'speech_metadata', style: speakingStyle }],
            },
          ],
        },
      ],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: AUDIO_SAMPLE_RATE },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AudioError(
      `语音服务请求失败（HTTP ${response.status}）`,
      response.status === 429 || response.status >= 500,
    );
  }
  const result = await boundedJson(response);
  if (!record(result) || !Array.isArray(result.steps)) throw new AudioError('语音服务响应结构无效');
  const blocks = result.steps.flatMap((step: unknown) =>
    record(step) && step.type === 'model_output' && Array.isArray(step.content)
      ? step.content.filter((content: unknown) => record(content) && content.type === 'audio')
      : [],
  );
  if (blocks.length !== 1 || typeof blocks[0].data !== 'string') {
    throw new AudioError('语音服务未返回唯一完整音频');
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(blocks[0].data), (character) => character.charCodeAt(0));
  } catch {
    throw new AudioError('语音服务返回无效音频编码');
  }
  return { bytes, info: parseWav(bytes), interactionId: typeof result.id === 'string' ? result.id : null };
}

export function wavStream(bucket: R2Bucket, parts: StoredWav[]): ReadableStream<Uint8Array> {
  const dataBytes = parts.reduce((total, part) => total + part.dataBytes, 0);
  const header = wavHeader(dataBytes);
  let partIndex = -1;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let remaining = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (partIndex === -1) {
          partIndex = 0;
          controller.enqueue(header);
          return;
        }
        while (partIndex < parts.length) {
          const part = parts[partIndex];
          if (!reader) {
            const object = await bucket.get(part.key, {
              range: { offset: part.dataOffset, length: part.dataBytes },
              onlyIf: { etagMatches: part.etag },
            });
            if (!object || !('body' in object)) throw new AudioError('音频素材在合成前发生变化');
            reader = object.body.getReader();
            remaining = part.dataBytes;
          }
          const next = await reader.read();
          if (next.done) {
            reader.releaseLock();
            reader = undefined;
            if (remaining !== 0) throw new AudioError('音频素材数据不完整');
            partIndex++;
            continue;
          }
          remaining -= next.value.byteLength;
          if (remaining < 0) throw new AudioError('音频素材数据超出声明大小');
          controller.enqueue(next.value);
          return;
        }
        controller.close();
      } catch (error) {
        await reader?.cancel();
        controller.error(error);
      }
    },
    async cancel() {
      await reader?.cancel();
    },
  });
}

export async function composeWav(bucket: R2Bucket, keys: string[], outputKey: string) {
  const parts: StoredWav[] = [];
  for (const key of keys) parts.push(await readStoredWav(bucket, key));
  const dataBytes = parts.reduce((total, part) => total + part.dataBytes, 0);
  if (dataBytes > 1800 * AUDIO_SAMPLE_RATE * 2) throw new AudioError('合成音频不能超过 30 分钟');
  const body = wavStream(bucket, parts);
  const fixed = new FixedLengthStream(44 + dataBytes);
  const controller = new AbortController();
  const piping = body.pipeTo(fixed.writable, { signal: controller.signal });
  const putting = bucket.put(outputKey, fixed.readable, {
    httpMetadata: { contentType: 'audio/wav', cacheControl: 'public, max-age=31536000, immutable' },
  });
  try {
    const [, object] = await Promise.all([piping, putting]);
    if (!object) throw new AudioError('合成音频写入失败');
  } catch (error) {
    controller.abort();
    if (!fixed.readable.locked) await fixed.readable.cancel(error);
    await Promise.allSettled([piping, putting]);
    throw error;
  }
  return { key: outputKey, bytes: dataBytes + 44, durationSeconds: dataBytes / (AUDIO_SAMPLE_RATE * 2) };
}
