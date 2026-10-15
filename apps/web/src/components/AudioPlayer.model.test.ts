import { describe, expect, it } from 'vitest';
import { audioErrorMessage, formatAudioTime } from './AudioPlayer.model';

describe('audio player presentation', () => {
  it.each([
    [0, '0:00'],
    [9.99, '0:09'],
    [59, '0:59'],
    [60, '1:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3723.9, '1:02:03'],
    [43200, '12:00:00'],
    [-1, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
  ])('formats %s seconds as %s without invalid media times', (input, expected) => {
    expect(formatAudioTime(input)).toBe(expected);
  });

  it.each([
    [1, '音频加载已中断，请重试。'],
    [2, '音频暂时无法加载，请检查网络后重试。'],
    [3, '音频无法解码，文件可能不完整。'],
    [4, '音频不存在，或浏览器不支持此格式。'],
    [undefined, '音频暂时无法播放，请重试。'],
    [99, '音频暂时无法播放，请重试。'],
  ])('explains media error %s without exposing implementation details', (code, expected) => {
    expect(audioErrorMessage(code)).toBe(expected);
  });
});
