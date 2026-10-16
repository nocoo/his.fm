import { describe, expect, it } from 'vitest';
import { isMp3Container, measureMp3Duration, mp3AudioStartOffset, parseMp3 } from './mp3.ts';
import { mpeg2Mp3Bytes, tinyMp3Bytes } from './mp3-fixtures.ts';
import { AudioError } from './wav.ts';

const tinyMp3 = tinyMp3Bytes;

function encodeSynchsafe(size: number) {
  return Uint8Array.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function wrapWithId3Padding(audio: Uint8Array, paddingBodyBytes: number) {
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 4, 0, 0]);
  header.set(encodeSynchsafe(paddingBodyBytes), 6);
  const file = new Uint8Array(10 + paddingBodyBytes + audio.length);
  file.set(header);
  file.set(audio, 10 + paddingBodyBytes);
  return file;
}

describe('parseMp3', () => {
  it('detects MP3 containers and rejects empty input', () => {
    expect(isMp3Container(tinyMp3)).toBe(true);
    expect(isMp3Container(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false);
    expect(() => parseMp3(new Uint8Array(2))).toThrow('有效的 MP3');
    const id3Only = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => parseMp3(id3Only)).toThrow('有效的 MP3');
  });

  it('reads duration from a short CBR file', () => {
    const info = parseMp3(tinyMp3);
    expect(info.durationSeconds).toBeGreaterThan(0.2);
    expect(info.durationSeconds).toBeLessThan(0.35);
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(1);
  });

  it('rejects partial buffers shorter than the declared file size', () => {
    const prefix = tinyMp3.subarray(0, 512);
    expect(() => parseMp3(prefix, tinyMp3.byteLength)).toThrow('不完整');
  });

  it('rejects bytes without a valid MPEG frame', () => {
    expect(() => parseMp3(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 8)).toThrow(
      '有效的 MP3',
    );
  });

  it('rejects truncated ID3 tags and non-container prefixes', () => {
    const id3 = new Uint8Array(12);
    id3.set([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]);
    expect(() => parseMp3(id3, 12)).toThrow('ID3');
    expect(isMp3Container(new Uint8Array([0x00, 0xff, 0xfb, 0x90]))).toBe(true);
    expect(() => parseMp3(tinyMp3.subarray(0, 48), 48)).toThrow('不完整');
  });

  it('rejects header-only sync words without a complete first frame', () => {
    expect(() => parseMp3(Uint8Array.from([0xff, 0xfb, 0x90, 0xc0]), 4)).toThrow('不完整');
    expect(() => parseMp3(Uint8Array.from([0xff, 0xfb, 0x00, 0xc0]), 4)).toThrow('帧头');
  });

  it('rejects a complete first frame followed by truncated next-frame bytes', () => {
    const frame1 = tinyMp3.subarray(45, 45 + 417);
    for (const extra of [4, 64, 128]) {
      const buf = new Uint8Array(frame1.length + extra);
      buf.set(frame1, 0);
      buf.set([0xff, 0xfb, 0x90, 0xc0], frame1.length);
      expect(() => parseMp3(buf)).toThrow('不完整');
    }
  });

  it('sums back-to-back frames in a contiguous excerpt', () => {
    const frame1 = tinyMp3.subarray(45, 45 + 417);
    const frame2 = tinyMp3.subarray(462, 462 + 417);
    const buf = new Uint8Array(frame1.length + frame2.length);
    buf.set(frame1, 0);
    buf.set(frame2, frame1.length);
    const parsed = parseMp3(buf);
    expect(parsed.durationSeconds).toBeCloseTo((1152 * 2) / 44100, 2);
  });

  it('parses MPEG2 sample-rate files', () => {
    expect(parseMp3(mpeg2Mp3Bytes).sampleRate).toBe(24000);
  });

  it('rejects streams that change MPEG version between frames', () => {
    const twin = tinyMp3.slice(45, 45 + 417 * 2);
    twin[418] = 0xf3;
    expect(() => parseMp3(twin)).toThrow('无效数据');
  });

  it('rejects when the declared object size exceeds the buffered bytes', () => {
    expect(() => parseMp3(tinyMp3, tinyMp3.length + 1)).toThrow('不完整');
  });

  it('rejects objects truncated before the first frame ends', () => {
    const buf = new Uint8Array(100);
    buf.set([0xff, 0xfb, 0x90, 0xc0], 0);
    expect(() => parseMp3(buf)).toThrow('不完整');
    expect(() => parseMp3(tinyMp3, tinyMp3.length - 200)).toThrow('不完整');
  });

  it('reports ID3 audio offsets and invalid tags', () => {
    expect(mp3AudioStartOffset(tinyMp3, tinyMp3.length)).toBeGreaterThan(0);
    const shortId3 = new Uint8Array(10);
    shortId3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
    expect(() => mp3AudioStartOffset(shortId3, 5)).toThrow('ID3');
    expect(isMp3Container(new Uint8Array([0x49]))).toBe(false);
    expect(isMp3Container(new Uint8Array([0x00, 0xff, 0xfb, 0x90, 0x00]))).toBe(true);
    expect(() => parseMp3(Uint8Array.from([0xff, 0xfb, 0xff, 0xc0, 0, 0, 0, 0]), 8)).toThrow(AudioError);
    const reserved = new Uint8Array(500);
    reserved.set([0xff, 0xea, 0x90, 0xc0], 0);
    expect(() => parseMp3(reserved)).toThrow('有效的 MP3');
  });

  it('rejects trailing bytes that are not a valid ID3v1 tag', () => {
    const padded = new Uint8Array(tinyMp3.length + 64);
    padded.set(tinyMp3);
    expect(() => parseMp3(padded)).toThrow('无效数据');
  });

  it('falls back to frame scan when Xing omits a frame count', () => {
    const bytes = tinyMp3.slice();
    const xing = mp3AudioStartOffset(bytes, bytes.length) + 4 + 17;
    bytes[xing + 7] = 14;
    expect(parseMp3(bytes).durationSeconds).toBeGreaterThan(0.2);
  });

  it('rejects zero-length Xing durations', () => {
    const bytes = tinyMp3.slice();
    const xing = mp3AudioStartOffset(bytes, bytes.length) + 4 + 17;
    bytes[xing + 8] = 0;
    bytes[xing + 9] = 0;
    bytes[xing + 10] = 0;
    bytes[xing + 11] = 0;
    expect(() => parseMp3(bytes)).toThrow('无法从 MP3 文件读取时长');
  });

  it('parses Xing headers that only include a frame count', () => {
    const bytes = tinyMp3.slice();
    const xing = mp3AudioStartOffset(bytes, bytes.length) + 4 + 17;
    bytes[xing + 4] = 0;
    bytes[xing + 5] = 0;
    bytes[xing + 6] = 0;
    bytes[xing + 7] = 1;
    expect(parseMp3(bytes).durationSeconds).toBeGreaterThan(0.2);
  });

  it('applies LAME encoder delay inside the first frame', () => {
    const bytes = tinyMp3.slice();
    const start = mp3AudioStartOffset(bytes, bytes.length);
    const xing = start + 4 + 17;
    const flags =
      (bytes[xing + 4] << 24) | (bytes[xing + 5] << 16) | (bytes[xing + 6] << 8) | bytes[xing + 7];
    let insert = xing + 12;
    if (flags & 0x02) insert += 4;
    if (flags & 0x04) insert += 100;
    if (flags & 0x08) insert += 4;
    bytes[insert] = 0x4c;
    bytes[insert + 1] = 0x41;
    bytes[insert + 2] = 0x4d;
    bytes[insert + 3] = 0x45;
    bytes[insert + 27] = 36;
    bytes[insert + 28] = 0x10;
    bytes[insert + 29] = 8;
    const baseline = parseMp3(tinyMp3).durationSeconds;
    const adjusted = parseMp3(bytes).durationSeconds;
    expect(adjusted).toBeLessThan(baseline);
  });

  it('ignores ID3v1 trailers shorter than 128 bytes', () => {
    const short = tinyMp3.subarray(0, 120);
    expect(() => parseMp3(short)).toThrow();
  });

  it('rejects a single-byte trailer after the frame scan', () => {
    const padded = new Uint8Array(tinyMp3.length + 1);
    padded.set(tinyMp3);
    expect(() => parseMp3(padded)).toThrow('无效数据');
    return measureMp3Duration(padded.length, async (offset, length) =>
      padded.subarray(offset, offset + length),
    ).then(
      () => {
        throw new Error('expected rejection');
      },
      (error) => expect(error).toBeInstanceOf(AudioError),
    );
  });

  it('excludes a trailing ID3v1 tag from the frame scan', () => {
    const tag = new Uint8Array(128);
    tag.set([0x54, 0x41, 0x47], 0);
    const withTag = new Uint8Array(tinyMp3.length + 128);
    withTag.set(tinyMp3);
    withTag.set(tag, tinyMp3.length);
    const tagged = parseMp3(withTag);
    const plain = parseMp3(tinyMp3);
    expect(tagged.durationSeconds).toBeCloseTo(plain.durationSeconds, 3);
  });

  it('parses audio after a 64 KiB ID3v2 padding block', () => {
    const audioStart = mp3AudioStartOffset(tinyMp3, tinyMp3.length);
    const audio = tinyMp3.subarray(audioStart);
    const padded = wrapWithId3Padding(audio, 64 * 1024 - 10);
    const info = parseMp3(padded);
    expect(info.durationSeconds).toBeGreaterThan(0.2);
    expect(info.durationSeconds).toBeLessThan(0.35);
  });
});

describe('measureMp3Duration', () => {
  const readFrom = (bytes: Uint8Array) => async (offset: number, length: number) => {
    if (offset + length > bytes.length) {
      throw new Error('read past buffer');
    }
    return bytes.subarray(offset, offset + length);
  };

  it('matches parseMp3 on a complete file', async () => {
    const parsed = parseMp3(tinyMp3);
    const measured = await measureMp3Duration(tinyMp3.length, readFrom(tinyMp3));
    expect(measured.durationSeconds).toBeCloseTo(parsed.durationSeconds, 6);
    expect(measured.sampleRate).toBe(parsed.sampleRate);
  });

  it('streams past a large ID3v2 prefix', async () => {
    const audioStart = mp3AudioStartOffset(tinyMp3, tinyMp3.length);
    const padded = wrapWithId3Padding(tinyMp3.subarray(audioStart), 64 * 1024 - 10);
    const parsed = parseMp3(padded);
    const measured = await measureMp3Duration(padded.length, readFrom(padded));
    expect(measured.durationSeconds).toBeCloseTo(parsed.durationSeconds, 6);
  });

  it('rejects truncated objects during streaming scan', async () => {
    const truncated = tinyMp3.subarray(0, tinyMp3.length - 200);
    await expect(measureMp3Duration(truncated.length, readFrom(truncated))).rejects.toThrow('不完整');
  });

  it('streams past an ID3v1 trailer', async () => {
    const tag = new Uint8Array(128);
    tag.set([0x54, 0x41, 0x47], 0);
    const withTag = new Uint8Array(tinyMp3.length + 128);
    withTag.set(tinyMp3);
    withTag.set(tag, tinyMp3.length);
    const measured = await measureMp3Duration(withTag.length, readFrom(withTag));
    expect(measured.durationSeconds).toBeCloseTo(parseMp3(withTag).durationSeconds, 6);
  });

  it('falls back to frame totals when Xing describes a longer master clip', async () => {
    const frame1 = tinyMp3.subarray(45, 45 + 417);
    const frame2 = tinyMp3.subarray(462, 462 + 417);
    const buf = new Uint8Array(frame1.length + frame2.length);
    buf.set(frame1, 0);
    buf.set(frame2, frame1.length);
    const measured = await measureMp3Duration(buf.length, readFrom(buf));
    expect(measured.durationSeconds).toBeCloseTo((1152 * 2) / 44100, 2);
  });

  it('rejects corrupt trailing bytes during streaming scan', async () => {
    const padded = new Uint8Array(tinyMp3.length + 64);
    padded.set(tinyMp3);
    await expect(measureMp3Duration(padded.length, readFrom(padded))).rejects.toThrow('无效数据');
  });

  it('loads the first frame when it spans the streaming probe window', async () => {
    const audioStart = mp3AudioStartOffset(tinyMp3, tinyMp3.length);
    const audio = tinyMp3.subarray(audioStart);
    const lead = new Uint8Array(256 * 1024 - 100);
    const audioBody = new Uint8Array(lead.length + audio.length);
    audioBody.set(lead);
    audioBody.set(audio, lead.length);
    const padded = wrapWithId3Padding(audioBody, 64);
    const measured = await measureMp3Duration(padded.length, readFrom(padded));
    expect(measured.durationSeconds).toBeCloseTo(parseMp3(padded).durationSeconds, 6);
  });

  it('rejects MPEG version changes during streaming scan', async () => {
    const twin = tinyMp3.slice(45, 45 + 417 * 2);
    twin[418] = 0xf3;
    await expect(measureMp3Duration(twin.length, readFrom(twin))).rejects.toThrow('无效数据');
  });

  it('rejects objects shorter than four bytes', async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33]);
    await expect(measureMp3Duration(bytes.length, readFrom(bytes))).rejects.toThrow('有效的 MP3');
  });

  it('rejects ID3-only objects without MPEG frames', async () => {
    const id3Only = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(measureMp3Duration(id3Only.length, readFrom(id3Only))).rejects.toThrow('有效的 MP3');
  });

  it('rejects streaming objects whose audio region is shorter than four bytes', async () => {
    const id3 = new Uint8Array(19);
    id3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 9]);
    await expect(measureMp3Duration(id3.length, readFrom(id3))).rejects.toThrow('有效的 MP3');
  });

  it('scans short clips without an ID3v1 trailer', async () => {
    const measured = await measureMp3Duration(tinyMp3.length, readFrom(tinyMp3));
    expect(measured.durationSeconds).toBeCloseTo(parseMp3(tinyMp3).durationSeconds, 6);
  });

  it('streams objects shorter than 128 bytes without ID3v1 handling', async () => {
    const small = tinyMp3.subarray(0, 120);
    await expect(measureMp3Duration(120, readFrom(small))).rejects.toThrow('不完整');
  });
});
