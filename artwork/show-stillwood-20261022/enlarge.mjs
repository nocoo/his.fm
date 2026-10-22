import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const source = await readFile(new URL('podcast-cover-master.png', import.meta.url));
let result;
let quality;
for (quality = 94; quality >= 35; quality--) {
  result = await sharp(source)
    .resize(3000, 3000, { kernel: 'lanczos3' })
    .removeAlpha()
    .toColourspace('srgb')
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  if (result.length < 500_000) break;
}
if (result.length >= 500_000) throw new Error('Cannot meet delivery budget');
await writeFile(new URL('podcast-cover-3000.jpg', import.meta.url), result);
console.log(JSON.stringify({ bytes: result.length, quality, sha256: createHash('sha256').update(result).digest('hex') }));
