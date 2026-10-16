import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mp3AudioStartOffset, mp3XingCatalogDuration, parseMp3 } from './mp3.ts';

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function renderVbrMp3(durationSeconds: number, output: string, sampleRate = 44100) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSeconds}`,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-q:a',
      '4',
      output,
    ],
    { stdio: 'ignore' },
  );
}

function probeDuration(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  const catalog = mp3XingCatalogDuration(bytes);
  if (catalog !== null) return catalog;
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    { encoding: 'utf8' },
  ).trim();
  return Number(out);
}

const ffmpeg = hasFfmpeg();

describe.runIf(ffmpeg)('parseMp3 VBR regressions', () => {
  it('parses MPEG-2.5 eight-kHz variable-bitrate audio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'his-mp3-'));
    const file = join(dir, 'mpeg25.mp3');
    try {
      renderVbrMp3(0.75, file, 8000);
      const expected = probeDuration(file);
      const parsed = parseMp3(new Uint8Array(readFileSync(file)));
      expect(parsed.sampleRate).toBe(8000);
      expect(parsed.durationSeconds).toBeGreaterThan(expected * 0.97);
      expect(parsed.durationSeconds).toBeLessThan(expected * 1.03);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches ffprobe on ffmpeg default VBR output at 0.2 seconds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'his-mp3-'));
    const file = join(dir, 'ffmpeg-02.mp3');
    try {
      renderVbrMp3(0.2, file);
      const expected = probeDuration(file);
      const parsed = parseMp3(new Uint8Array(readFileSync(file)));
      expect(parsed.durationSeconds).toBeGreaterThan(expected * 0.97);
      expect(parsed.durationSeconds).toBeLessThan(expected * 1.03);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads LAME gapless metadata from libmp3lame output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'his-mp3-'));
    const file = join(dir, 'lame.mp3');
    try {
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=0.2',
          '-ac',
          '1',
          '-ar',
          '44100',
          '-c:a',
          'libmp3lame',
          '-q:a',
          '2',
          file,
        ],
        { stdio: 'ignore' },
      );
      const expected = probeDuration(file);
      const parsed = parseMp3(new Uint8Array(readFileSync(file)));
      expect(parsed.durationSeconds).toBeGreaterThan(expected * 0.97);
      expect(parsed.durationSeconds).toBeLessThan(expected * 1.03);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches ffprobe on a short variable-bitrate clip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'his-mp3-'));
    const file = join(dir, 'short.mp3');
    try {
      renderVbrMp3(1.056, file);
      const expected = probeDuration(file);
      const bytes = new Uint8Array(readFileSync(file));
      const parsed = parseMp3(bytes);
      expect(parsed.durationSeconds).toBeGreaterThan(expected * 0.97);
      expect(parsed.durationSeconds).toBeLessThan(expected * 1.03);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses scanned duration when Xing frame count is badly understated on long VBR audio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'his-mp3-'));
    const file = join(dir, 'understated-xing.mp3');
    try {
      renderVbrMp3(3700.056, file, 8000);
      const bytes = new Uint8Array(readFileSync(file));
      const xing = mp3AudioStartOffset(bytes, bytes.length) + 4 + 9;
      bytes[xing + 8] = 0;
      bytes[xing + 9] = 0;
      bytes[xing + 10] = 0;
      bytes[xing + 11] = 1;
      const parsed = parseMp3(bytes);
      expect(parsed.durationSeconds).toBeGreaterThan(3600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('reports duration above the one-hour production cap for long VBR narration (regression)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'his-mp3-'));
    const file = join(dir, 'long.mp3');
    try {
      renderVbrMp3(3700.056, file, 8000);
      const expected = probeDuration(file);
      expect(expected).toBeGreaterThan(3600);
      const bytes = new Uint8Array(readFileSync(file));
      const parsed = parseMp3(bytes);
      expect(parsed.durationSeconds).toBeGreaterThan(3600);
      expect(parsed.durationSeconds).toBeGreaterThan(expected * 0.97);
      expect(parsed.durationSeconds).toBeLessThan(expected * 1.03);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
