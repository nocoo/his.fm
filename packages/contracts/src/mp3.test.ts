import { describe, expect, it } from 'vitest';
import { isMp3Container, parseMp3 } from './mp3.ts';
import { mpeg2Mp3Bytes, tinyMp3Bytes } from './mp3-fixtures.ts';

const tinyMp3 = tinyMp3Bytes;

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

  it('uses file size when only a header prefix is available', () => {
    const prefix = tinyMp3.subarray(0, 512);
    const info = parseMp3(prefix, tinyMp3.byteLength);
    expect(info.durationSeconds).toBeGreaterThan(0.2);
    expect(info.durationSeconds).toBeLessThan(0.35);
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
    expect(() => parseMp3(tinyMp3.subarray(0, 48), 48)).toThrow('时长');
  });

  it('rejects invalid bitrate indices and zero-length CBR estimates', () => {
    expect(() => parseMp3(Uint8Array.from([0xff, 0xfb, 0x00, 0xc0]), 4)).toThrow('帧头');
    expect(() => parseMp3(Uint8Array.from([0xff, 0xfb, 0x90, 0xc0]), 128)).toThrow('时长');
  });

  it('parses MPEG2 sample-rate files', () => {
    expect(parseMp3(mpeg2Mp3Bytes).sampleRate).toBe(24000);
  });

  it('walks consecutive frames when no Xing header is present', () => {
    const frame = tinyMp3.subarray(462, 462 + 300);
    const cbr = new Uint8Array(frame.length * 3);
    for (let i = 0; i < 3; i++) cbr.set(frame, i * frame.length);
    const info = parseMp3(cbr);
    expect(info.durationSeconds).toBeGreaterThan(0.05);
    expect(info.sampleRate).toBe(44100);
  });
});
