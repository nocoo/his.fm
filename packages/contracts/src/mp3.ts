import { AudioError } from './wav.ts';

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];
const MPEG2_SAMPLE_RATES = [22050, 24000, 16000];
const MPEG25_SAMPLE_RATES = [11025, 12000, 8000];
const ID3V1_TRAILER_BYTES = 128;

export type Mp3Info = {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
};

function readSynchsafeSize(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

/** Audio start offset after a leading ID3v2 tag; requires the 10-byte ID3 header in `bytes`. */
export function mp3AudioStartOffset(bytes: Uint8Array, fileSize: number) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const tagSize = readSynchsafeSize(bytes, 6);
  const total = 10 + tagSize;
  if (total > fileSize) throw new AudioError('MP3 ID3 标签不完整');
  return total;
}

function skipId3v2(bytes: Uint8Array, fileSize: number) {
  return mp3AudioStartOffset(bytes, fileSize);
}

function hasId3v1Trailer(bytes: Uint8Array, fileSize: number) {
  if (fileSize < ID3V1_TRAILER_BYTES) return false;
  const start = fileSize - ID3V1_TRAILER_BYTES;
  return bytes[start] === 0x54 && bytes[start + 1] === 0x41 && bytes[start + 2] === 0x47;
}

function frameSyncAt(bytes: Uint8Array, offset: number) {
  return offset + 1 < bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0;
}

function sampleRatesForVersion(versionBits: number) {
  if (versionBits === 3) return MPEG1_SAMPLE_RATES;
  if (versionBits === 2) return MPEG2_SAMPLE_RATES;
  return MPEG25_SAMPLE_RATES;
}

function parseFrameHeader(bytes: Uint8Array, offset: number) {
  const h = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  const versionBits = (h >> 19) & 0x3;
  if (versionBits === 1) throw new AudioError('音频必须是有效的 MP3 文件');
  const layerBits = (h >> 17) & 0x3;
  if (layerBits !== 1) throw new AudioError('音频必须是 MP3（MPEG Layer III）');
  const bitrateIndex = (h >> 12) & 0xf;
  const sampleRateIndex = (h >> 10) & 0x3;
  const padding = (h >> 9) & 0x1;
  const channelMode = (h >> 6) & 0x3;
  if (bitrateIndex === 0 || bitrateIndex === 0xf || sampleRateIndex === 0x3) {
    throw new AudioError('MP3 帧头无效');
  }
  const mpeg1 = versionBits === 3;
  const bitrates = mpeg1 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES;
  const sampleRates = sampleRatesForVersion(versionBits);
  const bitrateKbps = bitrates[bitrateIndex];
  const sampleRate = sampleRates[sampleRateIndex];
  const frameLength = mpeg1
    ? Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding
    : Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;
  const samplesPerFrame = mpeg1 ? 1152 : 576;
  const channels = channelMode === 3 ? 1 : 2;
  return { frameLength, sampleRate, samplesPerFrame, channels, bitrateKbps, versionBits };
}

/** Returns true when bytes look like MP3 (ID3 tag or MPEG frame sync), not RIFF WAV. */
export function isMp3Container(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return frameSyncAt(bytes, 0) || (bytes.length > 3 && frameSyncAt(bytes, 1));
}

function locateFirstFrame(bytes: Uint8Array, fileSize: number) {
  let offset = skipId3v2(bytes, fileSize);
  const searchEnd = Math.min(fileSize, bytes.length);
  while (offset < searchEnd) {
    if (frameSyncAt(bytes, offset)) {
      const header = parseFrameHeader(bytes, offset);
      if (offset + header.frameLength > fileSize) {
        throw new AudioError('MP3 文件不完整');
      }
      if (offset + header.frameLength > bytes.length) {
        throw new AudioError('MP3 文件不完整');
      }
      return { offset, header };
    }
    offset++;
    if (offset > searchEnd - 4) break;
  }
  throw new AudioError('音频必须是有效的 MP3 文件');
}

function durationFromFrames(bytes: Uint8Array, fileSize: number, offset: number) {
  const audioEnd = hasId3v1Trailer(bytes, fileSize) ? fileSize - ID3V1_TRAILER_BYTES : fileSize;
  let totalSamples = 0;
  let sampleRate = 0;
  let channels = 1;
  let versionBits = -1;
  let cursor = offset;
  let frames = 0;
  while (cursor + 4 <= audioEnd) {
    if (!frameSyncAt(bytes, cursor)) {
      throw new AudioError('MP3 文件不完整或包含无效数据');
    }
    const header = parseFrameHeader(bytes, cursor);
    if (cursor + header.frameLength > audioEnd) {
      throw new AudioError('MP3 文件不完整');
    }
    if (frames === 0) {
      sampleRate = header.sampleRate;
      channels = header.channels;
      versionBits = header.versionBits;
    } else if (header.sampleRate !== sampleRate || header.versionBits !== versionBits) {
      throw new AudioError('MP3 文件不完整或包含无效数据');
    }
    totalSamples += header.samplesPerFrame;
    cursor += header.frameLength;
    frames++;
  }
  if (frames === 0) throw new AudioError('无法从 MP3 文件读取时长');
  if (cursor < audioEnd) {
    throw new AudioError('MP3 文件不完整或包含无效数据');
  }
  const encoderDelaySamples = versionBits === 3 ? 529 : 576;
  const playableSamples = Math.max(0, totalSamples - encoderDelaySamples);
  return { durationSeconds: playableSamples / sampleRate, sampleRate, channels };
}

/**
 * Derives duration by scanning every MPEG Layer III frame (VBR-safe). The buffer must cover the
 * full object (`bytes.byteLength >= fileSize`); partial prefixes are rejected.
 */
export function parseMp3(bytes: Uint8Array, fileSize = bytes.byteLength): Mp3Info {
  if (fileSize < 4) throw new AudioError('音频必须是有效的 MP3 文件');
  if (bytes.byteLength < fileSize) {
    throw new AudioError('MP3 文件不完整');
  }
  const { offset } = locateFirstFrame(bytes, fileSize);
  const result = durationFromFrames(bytes, fileSize, offset);
  if (!Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) {
    throw new AudioError('无法从 MP3 文件读取时长');
  }
  return result;
}
