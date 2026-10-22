import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const directory = new URL('./', import.meta.url);
const identity = await readFile(new URL('../../apps/web/src/brand/identity.svg', directory), 'utf8');
const wordmark = identity.match(/<symbol id="wordmark"[^>]*>(.*?)<\/symbol>/s)?.[1];
if (!wordmark) throw new Error('Canonical wordmark not found');
const original = await readFile(new URL('background-original.png', directory));
const metadata = await sharp(original).metadata();
if (metadata.width !== 2880 || metadata.height !== 2880) {
  throw new Error(`Unexpected native size: ${metadata.width}x${metadata.height}`);
}

const ink = '#ECEBE1';
const probe = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="1700" viewBox="0 0 600 170" color="${ink}">${wordmark}</svg>`);
const { data, info } = await sharp(probe).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let minX = info.width;
let minY = info.height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 8) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}
const bounds = { x: minX / 10, y: minY / 10, width: (maxX - minX + 1) / 10, height: (maxY - minY + 1) / 10 };

function broadcast(centerY) {
  return [
    { endpoint: 205, scale: 1.9, stroke: 13, opacity: 0.96 },
    { endpoint: 145, scale: 2.55, stroke: 9, opacity: 0.46 },
  ].map(({ endpoint, scale, stroke, opacity }) => {
    const left = `<path d="M48 16C7 27 7 101 48 112" transform="translate(${endpoint - 48 * scale} ${centerY - 64 * scale}) scale(${scale})"/>`;
    return `<g fill="none" stroke="${ink}" stroke-width="${stroke}" stroke-linecap="round" opacity="${opacity}">${left}<g transform="translate(1000 0) scale(-1 1)">${left}</g></g>`;
  }).join('');
}

function overlay(width, height) {
  const logicalHeight = height / width * 1000;
  const centerY = logicalHeight / 2;
  const scale = 510 / bounds.width;
  const x = 500 - (bounds.x + bounds.width / 2) * scale;
  const y = centerY - (bounds.y + bounds.height / 2) * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 ${logicalHeight}" color="${ink}">${broadcast(centerY)}<g transform="translate(${x} ${y}) scale(${scale})">${wordmark}</g></svg>`;
}

const manifest = {
  status: 'local review only; not uploaded or approved',
  original: { path: 'background-original.png', width: metadata.width, height: metadata.height, bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') },
  identitySource: 'apps/web/src/brand/identity.svg',
  identitySha256: createHash('sha256').update(identity).digest('hex'),
  wordmarkPaintedBounds: bounds,
  composition: 'Unmodified canonical wordmark paths, centered by painted bounds; broadcast echoes derived from the canonical parenthesis curve. Center crop for landscape. No upscaling.',
  assets: [],
};

for (const [name, width, height] of [['podcast-cover', 2880, 2880], ['homepage-social', 1200, 630]]) {
  const svg = overlay(width, height);
  await writeFile(new URL(`${name}-overlay.svg`, directory), svg);
  const composite = await sharp(original).resize(width, height, { fit: 'cover', position: 'centre', withoutEnlargement: true })
    .composite([{ input: Buffer.from(svg) }]).removeAlpha().toColourspace('srgb').png().toBuffer();
  await writeFile(new URL(`${name}-master.png`, directory), composite);
  let delivery;
  let quality;
  for (quality = 94; quality >= 35; quality--) {
    delivery = await sharp(composite).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
    if (delivery.length < 500_000) break;
  }
  if (delivery.length >= 500_000) throw new Error(`Cannot meet delivery budget: ${name}`);
  await writeFile(new URL(`${name}.jpg`, directory), delivery);
  manifest.assets.push({ path: `${name}.jpg`, width, height, bytes: delivery.length, quality, format: 'jpeg', colourspace: 'srgb', alpha: false, sha256: createHash('sha256').update(delivery).digest('hex') });
  await sharp(delivery).resize(name === 'podcast-cover' ? 960 : 1200).png().toFile(fileURLToPath(new URL(`${name}-review.png`, directory)));
  if (name === 'podcast-cover') await sharp(delivery).resize(160, 160).png().toFile(fileURLToPath(new URL('podcast-cover-thumbnail.png', directory)));
}
await writeFile(new URL('delivery.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest.assets, null, 2));
