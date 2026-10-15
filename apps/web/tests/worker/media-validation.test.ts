import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { rasterType } from '../../worker/media-validation';

it('recognizes supported raster signatures and rejects corrupt or incomplete containers', () => {
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const webp = Uint8Array.from(readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)));
  const jpeg = new Uint8Array(32);
  jpeg.set([255, 216, 255, 224]);
  jpeg.set([255, 217], 30);
  for (const [bytes, mime, extension] of [
    [png, 'image/png', 'png'],
    [jpeg, 'image/jpeg', 'jpg'],
    [webp, 'image/webp', 'webp'],
  ] as const)
    expect(rasterType(bytes)).toEqual({ mime, extension });
  for (const [bytes, indices] of [
    [png, [0, 1, 4, 5, 6, 7, 12, png.length - 8]],
    [jpeg, [0, 1, 2, 30, 31]],
    [webp, [0, 4, 8, 12]],
  ] as const) {
    for (const index of indices) {
      const broken = bytes.slice();
      broken[index] = 0;
      expect(() => rasterType(broken)).toThrow();
    }
    expect(() => rasterType(bytes.slice(0, 10))).toThrow();
  }
});
