import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = dirname(fileURLToPath(import.meta.url));
const artwork = join(root, '../artwork/show-stillwood-20261022');
const publicDirectory = join(root, '../apps/web/public');
const source = join(artwork, 'podcast-cover-3000.jpg');
const iconDirectory = join(publicDirectory, 'brand/icons');

const publication = JSON.parse(await readFile(join(artwork, 'publication.json'), 'utf8'));
const published = publication.assets.find((asset) => asset.file === 'podcast-cover-3000.jpg');
const cover = await readFile(source);
const digest = createHash('sha256').update(cover).digest('hex');
if (digest !== published?.sha256) {
  throw new Error(`${source} is not the published channel cover: ${digest}`);
}

await mkdir(iconDirectory, { recursive: true });
const targets = [
  { path: join(publicDirectory, 'apple-touch-icon.png'), size: 180 },
  { path: join(iconDirectory, 'icon-192.png'), size: 192 },
  { path: join(iconDirectory, 'icon-512.png'), size: 512 },
];

for (const { path, size } of targets) {
  await sharp(cover)
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .flatten({ background: '#ECEBE1' })
    .removeAlpha()
    .png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true, palette: false })
    .toFile(path);
  const { size: bytes } = await stat(path);
  console.log(`${relative(root, path)} ${size}x${size} ${bytes} bytes`);
}
