import { AudioError } from './wav.ts';

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];
const MPEG2_SAMPLE_RATES = [22050, 24000, 16000];
const MPEG25_SAMPLE_RATES = [11025, 12000, 8000];
const ID3V1_TRAILER_BYTES = 128;
const MP3_PROBE_BYTES = 256 * 1024;
/** MPEG encoders may append a few bit-reservoir frames after the Xing-declared count. */
const XING_MAX_TRAILING_PADDING_FRAMES = 2;

/** R2 / Worker scan chunk size: one ranged GET covers ~128 KiB (~hundreds of frames), not one GET per frame. */
export const MP3_STREAM_SCAN_CHUNK_BYTES = 128 * 1024;

export type Mp3Info = {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
};

export type Mp3ReadChunk = (offset: number, length: number) => Promise<Uint8Array>;

export type Mp3MeasureStats = {
  readCount: number;
};

type FrameHeader = {
  frameLength: number;
  sampleRate: number;
  samplesPerFrame: number;
  channels: number;
  bitrateKbps: number;
  versionBits: number;
};

function readU32BE(bytes: Uint8Array, offset: number) {
  return (
    (((bytes[offset] & 0xff) << 24) |
      ((bytes[offset + 1] & 0xff) << 16) |
      ((bytes[offset + 2] & 0xff) << 8) |
      (bytes[offset + 3] & 0xff)) >>>
    0
  );
}

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

function hasId3v1TrailerAt(bytes: Uint8Array, trailerStart: number) {
  return bytes[trailerStart] === 0x54 && bytes[trailerStart + 1] === 0x41 && bytes[trailerStart + 2] === 0x47;
}

function hasId3v1Trailer(bytes: Uint8Array, fileSize: number) {
  if (fileSize < ID3V1_TRAILER_BYTES || bytes.length < fileSize) return false;
  return hasId3v1TrailerAt(bytes, fileSize - ID3V1_TRAILER_BYTES);
}

function frameSyncAt(bytes: Uint8Array, offset: number) {
  return offset + 1 < bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0;
}

function sampleRatesForVersion(versionBits: number) {
  if (versionBits === 3) return MPEG1_SAMPLE_RATES;
  if (versionBits === 2) return MPEG2_SAMPLE_RATES;
  return MPEG25_SAMPLE_RATES;
}

function parseFrameHeader(bytes: Uint8Array, offset: number): FrameHeader {
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

function sideInfoSize(header: FrameHeader) {
  const mpeg1 = header.versionBits === 3;
  const mono = header.channels === 1;
  if (mpeg1) return mono ? 17 : 32;
  return mono ? 9 : 17;
}

function isXingOrInfoTag(bytes: Uint8Array, offset: number) {
  const xing =
    bytes[offset] === 0x58 &&
    bytes[offset + 1] === 0x69 &&
    bytes[offset + 2] === 0x6e &&
    bytes[offset + 3] === 0x67;
  const info =
    bytes[offset] === 0x49 &&
    bytes[offset + 1] === 0x6e &&
    bytes[offset + 2] === 0x66 &&
    bytes[offset + 3] === 0x6f;
  return xing || info;
}

function encoderTagKind(bytes: Uint8Array, offset: number) {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === 0x4c && b === 0x41 && c === 0x4d && d === 0x45) return 'lame';
  if (a === 0x4c && b === 0x61 && c === 0x76 && d === 0x63) return 'lavc';
  if (a === 0x4c && b === 0x61 && c === 0x76 && d === 0x66) return 'lavf';
  return null;
}

/** LAME / libavcodec Info extension: 12-bit encoder delay and padding at tag+21..23. */
function gaplessFromEncoderTag(bytes: Uint8Array, tagStart: number) {
  const delaySamples = ((bytes[tagStart + 21] & 0xff) << 4) | ((bytes[tagStart + 22] & 0xf0) >> 4);
  const paddingSamples = ((bytes[tagStart + 22] & 0x0f) << 8) | (bytes[tagStart + 23] & 0xff);
  return { delaySamples, paddingSamples };
}

function encoderGaplessInFrame(bytes: Uint8Array, searchStart: number, searchEnd: number) {
  let delaySamples = 0;
  let paddingSamples = 0;
  for (let j = searchStart; j + 24 <= searchEnd; j++) {
    const kind = encoderTagKind(bytes, j);
    if (!kind) continue;
    const gapless = gaplessFromEncoderTag(bytes, j);
    delaySamples = gapless.delaySamples;
    paddingSamples = gapless.paddingSamples;
    break;
  }
  return { delaySamples, paddingSamples };
}

type XingMeta = {
  frameCount: number;
  delaySamples: number;
  paddingSamples: number;
};

function parseXingMeta(
  bytes: Uint8Array,
  frameOffset: number,
  frameLength: number,
  header: FrameHeader,
): XingMeta | null {
  const xingStart = frameOffset + 4 + sideInfoSize(header);
  const frameEnd = frameOffset + frameLength;
  if (xingStart + 12 > bytes.length || xingStart + 12 > frameEnd) return null;
  if (!isXingOrInfoTag(bytes, xingStart)) return null;
  const flags = readU32BE(bytes, xingStart + 4);
  if ((flags & 0x01) === 0) return null;
  const frameCount = readU32BE(bytes, xingStart + 8);
  let pos = xingStart + 12;
  if (flags & 0x02) pos += 4;
  if (flags & 0x04) pos += 100;
  if (flags & 0x08) pos += 4;
  const { delaySamples, paddingSamples } = encoderGaplessInFrame(
    bytes,
    pos,
    Math.min(frameEnd, bytes.length),
  );
  return { frameCount, delaySamples, paddingSamples };
}

function mp3InfoFromXing(meta: XingMeta, header: FrameHeader): Mp3Info {
  const samples = Math.max(
    0,
    meta.frameCount * header.samplesPerFrame - meta.delaySamples - meta.paddingSamples,
  );
  return {
    durationSeconds: samples / header.sampleRate,
    sampleRate: header.sampleRate,
    channels: header.channels,
  };
}

/** LAME/Lavc/Lavf share tag+21..23; apply trim when present and it leaves a positive sample count. */
function xingDurationForScan(meta: XingMeta, header: FrameHeader): Mp3Info {
  const raw = mp3InfoFromXing({ ...meta, delaySamples: 0, paddingSamples: 0 }, header);
  if (meta.delaySamples === 0 && meta.paddingSamples === 0) return raw;
  const totalSamples = meta.frameCount * header.samplesPerFrame;
  if (meta.delaySamples + meta.paddingSamples >= totalSamples) return raw;
  return mp3InfoFromXing(meta, header);
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
  return { durationSeconds: totalSamples / sampleRate, sampleRate, channels, frameCount: frames };
}

function finalizeMp3Info(result: Mp3Info): Mp3Info {
  if (!Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) {
    throw new AudioError('无法从 MP3 文件读取时长');
  }
  return result;
}

/** Xing/Info `frameCount` is audio frames only; the carrier MPEG frame is extra. */
function xingDeclaredMpegFrameCount(xingMeta: XingMeta) {
  return xingMeta.frameCount + 1;
}

function resolveMp3Duration(
  header: FrameHeader,
  xingMeta: XingMeta | null,
  scanned: { durationSeconds: number; sampleRate: number; channels: number; frameCount: number },
): Mp3Info {
  const { frameCount: _frames, ...scannedInfo } = scanned;
  if (!xingMeta) return scannedInfo;
  if (xingMeta.frameCount === 0) {
    throw new AudioError('无法从 MP3 文件读取时长');
  }
  const declaredMpegFrames = xingDeclaredMpegFrameCount(xingMeta);
  if (scanned.frameCount < declaredMpegFrames) {
    throw new AudioError('MP3 文件不完整');
  }
  if (scanned.frameCount === declaredMpegFrames) {
    return xingDurationForScan(xingMeta, header);
  }
  const paddingFrames = scanned.frameCount - declaredMpegFrames;
  if (paddingFrames <= XING_MAX_TRAILING_PADDING_FRAMES) {
    return xingDurationForScan(xingMeta, header);
  }
  return scannedInfo;
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
  const { offset, header } = locateFirstFrame(bytes, fileSize);
  const xingMeta = parseXingMeta(bytes, offset, header.frameLength, header);
  const scanned = durationFromFrames(bytes, fileSize, offset);
  return finalizeMp3Info(resolveMp3Duration(header, xingMeta, scanned));
}

class Mp3ChunkReader {
  private buffer = new Uint8Array(0);
  private bufferStart = 0;
  private countedReads = 0;
  private readonly fileSize: number;
  private readonly read: Mp3ReadChunk;
  private readonly chunkBytes: number;
  private readonly stats?: Mp3MeasureStats;

  constructor(fileSize: number, read: Mp3ReadChunk, chunkBytes: number, stats?: Mp3MeasureStats) {
    this.fileSize = fileSize;
    this.read = read;
    this.chunkBytes = chunkBytes;
    this.stats = stats;
  }

  private noteRead() {
    this.countedReads++;
    if (this.stats) this.stats.readCount = this.countedReads;
  }

  async ensureBytes(offset: number, length: number): Promise<Uint8Array> {
    const end = offset + length;
    if (end > this.fileSize) throw new AudioError('MP3 文件不完整');
    if (
      this.buffer.length > 0 &&
      offset >= this.bufferStart &&
      end <= this.bufferStart + this.buffer.length
    ) {
      const local = offset - this.bufferStart;
      return this.buffer.subarray(local, local + length);
    }
    const needLen = end - offset;
    const remaining = this.fileSize - offset;
    const fetchLen = Math.min(remaining, Math.max(needLen, this.chunkBytes));
    this.noteRead();
    this.buffer = new Uint8Array(await this.read(offset, fetchLen));
    this.bufferStart = offset;
    const local = offset - this.bufferStart;
    if (local < 0 || local + length > this.buffer.length) {
      throw new AudioError('MP3 文件不完整');
    }
    return this.buffer.subarray(local, local + length);
  }
}

async function readId3AudioStart(reader: Mp3ChunkReader, fileSize: number) {
  const head = await reader.ensureBytes(0, Math.min(10, fileSize));
  return mp3AudioStartOffset(head, fileSize);
}

async function readHasId3v1Trailer(reader: Mp3ChunkReader, fileSize: number) {
  if (fileSize < ID3V1_TRAILER_BYTES) return false;
  const tail = await reader.ensureBytes(fileSize - ID3V1_TRAILER_BYTES, ID3V1_TRAILER_BYTES);
  return hasId3v1TrailerAt(tail, 0);
}

async function locateFirstFrameStreaming(reader: Mp3ChunkReader, fileSize: number) {
  const audioStart = await readId3AudioStart(reader, fileSize);
  const probeLength = Math.min(MP3_PROBE_BYTES, fileSize - audioStart);
  if (probeLength < 4) throw new AudioError('音频必须是有效的 MP3 文件');
  const probe = await reader.ensureBytes(audioStart, probeLength);
  const { offset: relative, header } = locateFirstFrame(probe, fileSize);
  const frameOffset = audioStart + relative;
  let frameBytes = probe;
  let frameLocalOffset = relative;
  if (relative + header.frameLength > probe.length) {
    frameBytes = await reader.ensureBytes(frameOffset, header.frameLength);
    frameLocalOffset = 0;
  }
  const xingMeta = parseXingMeta(frameBytes, frameLocalOffset, header.frameLength, header);
  return { frameOffset, header, xingMeta };
}

async function scanMp3FramesBuffered(
  reader: Mp3ChunkReader,
  fileSize: number,
  startOffset: number,
  firstHeader: FrameHeader,
) {
  const audioEnd = (await readHasId3v1Trailer(reader, fileSize)) ? fileSize - ID3V1_TRAILER_BYTES : fileSize;
  let totalSamples = 0;
  const sampleRate = firstHeader.sampleRate;
  const versionBits = firstHeader.versionBits;
  let cursor = startOffset;
  let frames = 0;
  while (cursor + 4 <= audioEnd) {
    const headerBytes = await reader.ensureBytes(cursor, 4);
    if (!frameSyncAt(headerBytes, 0)) {
      throw new AudioError('MP3 文件不完整或包含无效数据');
    }
    const header = parseFrameHeader(headerBytes, 0);
    if (cursor + header.frameLength > audioEnd) {
      throw new AudioError('MP3 文件不完整');
    }
    if (frames > 0 && (header.sampleRate !== sampleRate || header.versionBits !== versionBits)) {
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
  return {
    durationSeconds: totalSamples / sampleRate,
    sampleRate,
    channels: firstHeader.channels,
    frameCount: frames,
  };
}

/**
 * Derives MP3 duration by scanning MPEG Layer III frames from R2 (or any ranged reader). Uses a
 * reusable {@link MP3_STREAM_SCAN_CHUNK_BYTES} buffer so long files need ~ceil(bytes/chunk) ranged
 * GETs (typically dozens for a one-hour file), not one subrequest per frame.
 */
export async function measureMp3Duration(
  fileSize: number,
  read: Mp3ReadChunk,
  options?: { stats?: Mp3MeasureStats; chunkBytes?: number },
): Promise<Mp3Info> {
  if (fileSize < 4) throw new AudioError('音频必须是有效的 MP3 文件');
  const chunkBytes = options?.chunkBytes ?? MP3_STREAM_SCAN_CHUNK_BYTES;
  const reader = new Mp3ChunkReader(fileSize, read, chunkBytes, options?.stats);
  const { frameOffset, header, xingMeta } = await locateFirstFrameStreaming(reader, fileSize);
  const scanned = await scanMp3FramesBuffered(reader, fileSize, frameOffset, header);
  return finalizeMp3Info(resolveMp3Duration(header, xingMeta, scanned));
}
