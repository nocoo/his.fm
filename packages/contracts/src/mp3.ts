import { AudioError } from './wav.ts';

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];
const MPEG2_SAMPLE_RATES = [22050, 24000, 16000];

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

function skipId3v2(bytes: Uint8Array, fileSize: number) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const tagSize = readSynchsafeSize(bytes, 6);
  const total = 10 + tagSize;
  if (total > fileSize) throw new AudioError('MP3 ID3 标签不完整');
  return total;
}

function frameSyncAt(bytes: Uint8Array, offset: number) {
  return offset + 1 < bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0;
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
  const sampleRates = mpeg1 ? MPEG1_SAMPLE_RATES : MPEG2_SAMPLE_RATES;
  const bitrateKbps = bitrates[bitrateIndex];
  const sampleRate = sampleRates[sampleRateIndex];
  const frameLength = mpeg1
    ? Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding
    : Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;
  const samplesPerFrame = mpeg1 ? 1152 : 576;
  const channels = channelMode === 3 ? 1 : 2;
  return { frameLength, sampleRate, samplesPerFrame, channels, bitrateKbps };
}

/** Returns true when bytes look like MP3 (ID3 tag or MPEG frame sync), not RIFF WAV. */
export function isMp3Container(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return frameSyncAt(bytes, 0) || (bytes.length > 3 && frameSyncAt(bytes, 1));
}

function locateFirstFrame(bytes: Uint8Array, fileSize: number) {
  let offset = skipId3v2(bytes, fileSize);
  while (offset < fileSize) {
    if (frameSyncAt(bytes, offset)) return { offset, header: parseFrameHeader(bytes, offset) };
    offset++;
    if (offset > fileSize - 4) break;
  }
  throw new AudioError('音频必须是有效的 MP3 文件');
}

function durationFromFrames(
  bytes: Uint8Array,
  fileSize: number,
  offset: number,
  first: ReturnType<typeof parseFrameHeader>,
) {
  let totalSamples = 0;
  let cursor = offset;
  while (cursor + 4 <= fileSize) {
    if (!frameSyncAt(bytes, cursor)) {
      cursor++;
      continue;
    }
    const header = parseFrameHeader(bytes, cursor);
    if (header.sampleRate !== first.sampleRate || header.bitrateKbps !== first.bitrateKbps) break;
    totalSamples += header.samplesPerFrame;
    cursor += header.frameLength;
  }
  if (totalSamples === 0) throw new AudioError('无法从 MP3 文件读取时长');
  return totalSamples / first.sampleRate;
}

/**
 * Derives duration from MP3 bytes. Walks MPEG Layer III frames when the buffer covers the full object;
 * otherwise estimates CBR duration from object size and the first frame header (VBR without a full scan may be approximate).
 */
export function parseMp3(bytes: Uint8Array, fileSize = bytes.byteLength): Mp3Info {
  if (fileSize < 4) throw new AudioError('音频必须是有效的 MP3 文件');
  const { offset, header: first } = locateFirstFrame(bytes, fileSize);
  const durationSeconds =
    bytes.byteLength >= fileSize
      ? durationFromFrames(bytes, fileSize, offset, first)
      : ((fileSize - offset - 128) * 8) / (first.bitrateKbps * 1000);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new AudioError('无法从 MP3 文件读取时长');
  }
  return { durationSeconds, sampleRate: first.sampleRate, channels: first.channels };
}
