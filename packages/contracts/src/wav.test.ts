import { describe, expect, it } from 'vitest';
import { parseWav, wavHeader } from './wav.ts';

const goldenHeader =
  '524946462c00000057415645666d74201000000001000100c05d000080bb0000020010006461746108000000';

function fixture(samples = [1, 2, 3, 4]) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  bytes.set(Buffer.from(goldenHeader, 'hex'));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => {
    view.setInt16(44 + index * 2, value, true);
  });
  return bytes;
}

function edited(offset: number, value: number, width = 2) {
  const bytes = fixture();
  const view = new DataView(bytes.buffer);
  if (width === 4) view.setUint32(offset, value, true);
  else view.setUint16(offset, value, true);
  return bytes;
}

describe('bounded PCM WAV parsing', () => {
  it('reads a standard WAV and creates the expected RIFF header', () => {
    expect(parseWav(fixture())).toEqual({
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      blockAlign: 2,
      dataOffset: 44,
      dataBytes: 8,
      durationSeconds: 1 / 6000,
    });
    expect(Buffer.from(wavHeader(8)).toString('hex')).toBe(goldenHeader);
    expect(parseWav(fixture().slice(0, 44), 52).dataBytes).toBe(8);
  });

  it('skips unknown odd-length chunks with their padding', () => {
    const original = fixture();
    const bytes = new Uint8Array(original.length + 12);
    bytes.set(original.subarray(0, 36));
    bytes.set(new TextEncoder().encode('JUNK'), 36);
    new DataView(bytes.buffer).setUint32(40, 3, true);
    bytes.set([1, 2, 3, 0], 44);
    bytes.set(original.subarray(36), 48);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    expect(parseWav(bytes).dataOffset).toBe(56);
  });

  it('rejects invalid files and incomplete RIFF structures', () => {
    for (const bytes of [new Uint8Array(), new TextEncoder().encode('NOT A WAVE FILE'), edited(8, 0)]) {
      expect(() => parseWav(bytes)).toThrow('RIFF WAV');
    }
    expect(() => parseWav(edited(4, 1000, 4))).toThrow('不完整');
    expect(() => parseWav(edited(4, 10, 4))).toThrow('不完整');
    expect(() => parseWav(edited(40, 1000, 4))).toThrow('边界');
    expect(() => parseWav(edited(16, 10, 4))).toThrow('格式段不完整');
    expect(() => parseWav(fixture().slice(0, 25), 52)).toThrow('格式段不完整');
    expect(() => parseWav(fixture().slice(0, 36), 52)).toThrow('缺少音频数据');
    expect(() => parseWav(edited(40, 7, 4))).toThrow('数据或格式');
    expect(() => parseWav(edited(40, 0, 4))).toThrow('数据或格式');
    const noFormat = fixture();
    noFormat.set(new TextEncoder().encode('JUNK'), 12);
    expect(() => parseWav(noFormat)).toThrow('数据或格式');
  });

  it('rejects formats that would produce corrupt concatenated audio', () => {
    for (const [offset, value, width] of [
      [20, 3, 2],
      [22, 2, 2],
      [24, 44100, 4],
      [28, 42, 4],
      [32, 4, 2],
      [34, 24, 2],
    ]) {
      expect(() => parseWav(edited(offset, value, width))).toThrow('24 kHz');
    }
    for (const bytes of [0, 1, -2, 1.5, 0xffffffff, Number.NaN]) {
      expect(() => wavHeader(bytes)).toThrow('大小无效');
    }
  });
});
