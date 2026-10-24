import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicUrl = (path: string) => new URL(`../public${path}`, import.meta.url);
const archiveUrl = (path: string) =>
  new URL(`../../../artwork/show-stillwood-20261022/${path}`, import.meta.url);

function pngHeader(path: string) {
  const bytes = readFileSync(publicUrl(path));
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

describe('installed-app icons', () => {
  it('ships opaque square PNGs for the home screen and the web app manifest', () => {
    expect(pngHeader('/apple-touch-icon.png')).toEqual({ width: 180, height: 180, colorType: 2 });
    const manifest = JSON.parse(readFileSync(publicUrl('/site.webmanifest'), 'utf8')) as {
      icons: { src: string; sizes: string; type: string }[];
    };
    expect(manifest.icons).toEqual([
      { src: '/brand/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ]);
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(icon.type).toBe('image/png');
      expect(pngHeader(icon.src)).toEqual({ width, height, colorType: 2 });
    }
  });

  it('never follows the theme, so every icon derives from the archived channel cover', () => {
    const publication = JSON.parse(readFileSync(archiveUrl('publication.json'), 'utf8')) as {
      assets: { file: string; sha256: string }[];
    };
    expect(publication.assets.find((asset) => asset.file === 'podcast-cover-3000.jpg')?.sha256).toBe(
      '0a64cac84ab3bbb8a1c5bcb03976b516698cb41cfec0ea2cdd9c5b5e1372cd85',
    );
    expect(readFileSync(publicUrl('/site.webmanifest'), 'utf8')).not.toContain('favicons');
  });
});
