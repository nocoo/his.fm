import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, type StorageObject, storageKind } from '../../shared/storage';
import { filterStorage, storageSummary } from './model';
import { storageMediaUrl, storageService } from './service';

const base: StorageObject = {
  key: 'cover.webp',
  version: 'v1',
  size: 1024,
  uploaded: '2026-01-01',
  contentType: 'image/webp',
  kind: 'image',
  state: 'referenced',
  reasons: ['节目：晚饭'],
};
const objects: StorageObject[] = [
  base,
  { ...base, key: 'old.wav', size: 8192, uploaded: '2025-01-01', kind: 'audio', state: 'unused' },
  { ...base, key: 'movie.mp4', size: 8192, uploaded: '2026-09-01', kind: 'video', state: 'unused' },
  { ...base, key: 'unknown', kind: 'other' },
];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('storage browsing and selected environment', () => {
  it('accounts for storage, filters references and sorts without changing inventory', () => {
    expect(storageSummary(objects)).toEqual({
      bytes: 18432,
      count: 4,
      unusedBytes: 16384,
      unusedCount: 2,
      mediaBytes: 16384,
    });
    expect(storageSummary([]).bytes).toBe(0);
    expect(filterStorage(objects, '晚饭', 'audio', 'unused', 'size').map((object) => object.key)).toEqual([
      'old.wav',
    ]);
    expect(filterStorage(objects, 'no match', 'all', 'all', 'size')).toEqual([]);
    expect(filterStorage(objects, '', 'all', 'referenced', 'size')).toHaveLength(2);
    expect(filterStorage(objects, '', 'all', 'all', 'size')[0].key).toBe('movie.mp4');
    expect(filterStorage(objects, '', 'all', 'all', 'oldest')[0].key).toBe('old.wav');
    expect(filterStorage(objects, '', 'all', 'all', 'newest')[0].key).toBe('movie.mp4');
    expect(objects[0]).toBe(base);
    expect([0, 10, 1024, 1536, 1024 ** 5].map(formatBytes)).toEqual([
      '0 B',
      '10 B',
      '1.0 KiB',
      '1.5 KiB',
      '1024.0 TiB',
    ]);
  });
  it('classifies real MIME metadata and extension-only imported assets', () => {
    expect(storageKind('unknown', 'image/png')).toBe('image');
    expect(storageKind('unknown', 'audio/mpeg')).toBe('audio');
    expect(storageKind('unknown', 'video/mp4')).toBe('video');
    for (const [key, kind] of [
      ['a.PNG', 'image'],
      ['a.wav', 'audio'],
      ['a.mp4', 'video'],
      ['a.zip', 'other'],
      ['', 'other'],
    ])
      expect(storageKind(key, '')).toBe(kind);
  });
  it('uses cursor encoding, cancellation, bounded mutations and the selected environment', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('{"objects":[],"cursor":null}'));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('localStorage', { getItem: () => 'local' });
    const signal = new AbortController().signal;
    await storageService.scan(null, signal);
    expect(fetcher.mock.calls[0]).toMatchObject(['/admin/api/storage', { signal }]);
    await storageService.scan('a&b=c');
    expect(fetcher.mock.calls[1][0]).toBe('/admin/api/storage?cursor=a%26b%3Dc');
    expect(storageMediaUrl('声音 & a.wav')).toBe(
      '/admin/api/storage/object?key=%E5%A3%B0%E9%9F%B3%20%26%20a.wav',
    );
    vi.stubGlobal('localStorage', { getItem: () => 'production' });
    await storageService.cleanup([{ key: 'a', version: 'v2' }]);
    expect(fetcher.mock.calls[2]).toMatchObject([
      '/admin/remote-api/storage/cleanup',
      { method: 'POST', body: '{"items":[{"key":"a","version":"v2"}]}', headers: { 'X-Hisfm-Remote': '1' } },
    ]);
    expect(storageMediaUrl('folder/声音 & a.wav')).toBe(
      'https://f.no.mt/folder/%E5%A3%B0%E9%9F%B3%20%26%20a.wav',
    );
    await storageService.cleanup([{ key: 'a', version: 'v2' }], 'local');
    expect(fetcher.mock.calls[3][0]).toBe('/admin/api/storage/cleanup');
    vi.stubEnv('DEV', false);
    expect(storageMediaUrl('x.wav')).toBe('/admin/api/storage/object?key=x.wav');
    fetcher.mockResolvedValueOnce(new Response('{"error":"请重新登录"}', { status: 401 }));
    await expect(storageService.scan(null)).rejects.toMatchObject({ status: 401 });
  });
});
