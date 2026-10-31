import { describe, expect, it } from 'vitest';
import { formatBytes, storageKind } from '../../src/shared/storage';

describe('storage helpers', () => {
  it('classifies kinds from content types and extensions', () => {
    expect(storageKind('a.png', 'image/png')).toBe('image');
    expect(storageKind('a.bin', 'application/octet-stream')).toBe('other');
    expect(storageKind('cover.webp', 'application/octet-stream')).toBe('image');
    expect(storageKind('take.flac', 'application/octet-stream')).toBe('audio');
    expect(storageKind('voice.m4a', 'application/octet-stream')).toBe('audio');
    expect(storageKind('voice.wav', '')).toBe('audio');
    expect(storageKind('track.ogg', '')).toBe('audio');
    expect(storageKind('photo.jpeg', '')).toBe('image');
    expect(storageKind('clip.mp4', '')).toBe('video');
    expect(storageKind('take.mov', '')).toBe('video');
    expect(storageKind('scene.m4v', 'application/octet-stream')).toBe('video');
    expect(storageKind('theme.svg', 'application/octet-stream')).toBe('image');
    expect(storageKind('voice.aac', 'application/octet-stream')).toBe('audio');
    expect(storageKind('clip.webm', 'video/webm')).toBe('video');
    expect(storageKind('stream.webm', 'application/octet-stream')).toBe('video');
    expect(storageKind('.hidden', 'application/octet-stream')).toBe('other');
  });

  it('formats byte sizes across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MiB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB');
    expect(formatBytes(5 * 1024 ** 4)).toMatch(/TiB$/);
  });
});
