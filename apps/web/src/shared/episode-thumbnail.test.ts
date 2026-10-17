import { describe, expect, it } from 'vitest';
import {
  episodeThumbnailKey,
  episodeThumbnailProps,
  episodeThumbnailSizes,
  episodeThumbnailWidths,
} from './episode-thumbnail';

describe('episode thumbnails', () => {
  it('accepts only configured R2 paths, including encoded keys and local media', () => {
    expect(episodeThumbnailKey('https://f.no.mt/productions/one/cover.png')).toBe(
      'productions/one/cover.png',
    );
    expect(episodeThumbnailKey('/media/covers/%E4%BB%8A%E5%A4%A9.png')).toBe('covers/今天.png');
    expect(episodeThumbnailKey('/media/one.png', 'http://localhost:7056', '/media')).toBe('one.png');
    expect(
      episodeThumbnailKey('https://cdn.test/store/one.png', 'https://his.fm', 'https://cdn.test/store'),
    ).toBe('one.png');
    for (const source of [
      '/images/episode-01.webp',
      'https://elsewhere.test/cover.png',
      'https://f.no.mt.evil.test/cover.png',
      'https://f.no.mt@evil.test/cover.png',
      'https://user:password@f.no.mt/cover.png',
      'https://f.no.mt/cover.png?w=99999',
      'https://f.no.mt/cover.png#fragment',
      'https://f.no.mt/',
      'https://f.no.mt/%',
      'https://f.no.mt/covers/%2e%2e%2fsecret.png',
      'https://f.no.mt/covers/%2e%2fsecret.png',
      'https://f.no.mt/covers/%5csecret.png',
      'https://f.no.mt/covers/%00secret.png',
      'https://f.no.mt//cover.png',
      'https://[invalid',
    ])
      expect(episodeThumbnailKey(source)).toBeNull();
    expect(
      episodeThumbnailKey('https://cdn.test/storehouse/one.png', 'https://his.fm', 'https://cdn.test/store'),
    ).toBeNull();
    expect(episodeThumbnailKey('/media/one.png', 'invalid')).toBeNull();
  });

  it('emits a finite saved-version srcset, never arbitrary transformation options', () => {
    const props = episodeThumbnailProps(
      { id: 'episode/one', version: 7, coverUrl: 'https://f.no.mt/cover.png' },
      'stillwood',
    );
    expect(props.src).toBe('/media/episode-thumbnails/episode%2Fone/7/stillwood/480.webp');
    expect(props.srcSet?.split(', ')).toEqual(
      episodeThumbnailWidths.map(
        (width) => `/media/episode-thumbnails/episode%2Fone/7/stillwood/${width}.webp ${width}w`,
      ),
    );
    for (const coverUrl of [
      '/images/cover.webp',
      'https://elsewhere.test/cover.png',
      'https://f.no.mt/images/episode-01.webp',
    ]) {
      expect(episodeThumbnailProps({ id: 'one', version: 1, coverUrl }, 'interval')).toEqual({
        src: coverUrl,
      });
    }
  });

  it('sizes lazy grid/list artwork automatically with layout fallbacks and sizes eager detail explicitly', () => {
    const grid = episodeThumbnailSizes(0.875);
    expect(grid.startsWith('auto, ')).toBe(true);
    expect(grid).toContain('(max-width: 480px) calc((100vw - 48px) * 0.875)');
    expect(grid).toContain('(max-width: 760px) calc(((100vw - 68px) / 2) * 0.875)');
    expect(grid).toContain('min(90.8vw, 1424px)');
    expect(episodeThumbnailSizes(1, false, true)).toBe(
      'auto, (max-width: 760px) calc((160px) * 1), calc((260px) * 1)',
    );
    const detail = episodeThumbnailSizes(1, true);
    expect(detail).not.toContain('auto');
    expect(detail).toContain('(max-width: 538px) calc((100vw - 48px) * 1)');
    expect(detail).toContain('0.4185');
  });
});
