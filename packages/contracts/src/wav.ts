export const AUDIO_SAMPLE_RATE = 24_000;

export class AudioError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'AudioError';
    this.retryable = retryable;
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
        if (/[。！？.!?\n]/.test(characters[index] ?? '')) {
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
