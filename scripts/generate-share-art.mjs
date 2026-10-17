import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Renderer } from '@takumi-rs/wasm/node';
import sharp from 'sharp';
import { composeShareSvg } from '../apps/web/src/shared/share-composition.ts';

const source = new URL('../docs/design/assets/05/logo.svg', import.meta.url);
const destination = resolve(
  process.argv[2] ?? fileURLToPath(new URL('../apps/web/public/brand/', import.meta.url)),
);
const wordmark = await readFile(source, 'utf8');
await mkdir(destination, { recursive: true });
await copyFile(source, resolve(destination, 'stillwood-wordmark.svg'));

const renderer = new Renderer();
try {
  for (const [filename, width, height] of [
    ['share.jpg', 1200, 630],
    ['podcast.jpg', 3000, 3000],
  ]) {
    const svg = composeShareSvg(wordmark, undefined, width, height);
    const png = await renderer.render(
      { type: 'image', src: filename, style: { width, height } },
      {
        width,
        height,
        format: 'png',
        images: [{ src: filename, data: new TextEncoder().encode(svg), cache: 'none' }],
      },
    );
    const jpeg = await sharp(png)
      .toColourspace('srgb')
      .removeAlpha()
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toBuffer();
    await writeFile(resolve(destination, filename), jpeg);
    console.log(`${filename}: ${width}x${height}, ${jpeg.length} bytes`);
  }
} finally {
  renderer.free();
}
