import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = dirname(fileURLToPath(import.meta.url));
const directory = join(root, '../apps/web/public/brand/favicons');
const sources = (await readdir(directory)).filter((name) => name.endsWith('.svg')).sort();

for (const name of sources) {
  const target = join(directory, name.replace(/\.svg$/, '-32.png'));
  await sharp(await readFile(join(directory, name)), { density: 384 })
    .resize(32, 32, { fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(target);
  const { size } = await stat(target);
  console.log(`${relative(root, target)} 32x32 ${size} bytes`);
}
