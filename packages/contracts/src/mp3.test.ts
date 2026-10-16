import { describe, expect, it } from 'vitest';
import { isMp3Container, mp3AudioStartOffset, parseMp3 } from './mp3.ts';
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

  it('skips false sync bytes while scanning frames', () => {
    const frame1 = tinyMp3.subarray(45, 45 + 417);
    const frame2 = tinyMp3.subarray(462, 462 + 417);
    const buf = new Uint8Array(frame1.length + 4 + frame2.length);
    buf.set(frame1, 0);
    buf.set([0xff, 0xff, 0xff, 0xff], frame1.length);
    buf.set(frame2, frame1.length + 4);
    const parsed = parseMp3(buf);
    expect(parsed.durationSeconds).toBeCloseTo((1152 * 2) / 44100, 2);
  });

  it('parses MPEG2 sample-rate files', () => {
    expect(parseMp3(mpeg2Mp3Bytes).sampleRate).toBe(24000);
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

  it('parses audio after a 64 KiB ID3v2 padding block', () => {
    const audioStart = mp3AudioStartOffset(tinyMp3, tinyMp3.length);
    const audio = tinyMp3.subarray(audioStart);
    const padded = wrapWithId3Padding(audio, 64 * 1024 - 10);
    const info = parseMp3(padded);
    expect(info.durationSeconds).toBeGreaterThan(0.2);
    expect(info.durationSeconds).toBeLessThan(0.35);
  });
});
