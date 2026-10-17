import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = new URL('../../../../', import.meta.url);
const archive = new URL('docs/design/assets/05/logo.svg', root);
const assets = new URL('apps/web/public/brand/', root);
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hisfm-share-art-'));
  await run(process.execPath, [fileURLToPath(new URL('scripts/generate-share-art.mjs', root)), directory], {
    cwd: tmpdir(),
    timeout: 30000,
  });
}, 35000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('reproducible Stillwood brand assets', () => {
  it.each([
    ['share.jpg', 1200, 630],
    ['podcast.jpg', 3000, 3000],
  ])('emits %s as opaque sRGB JPEG without embedded metadata', async (name, width, height) => {
    const bytes = await readFile(join(directory, name));
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({
      format: 'jpeg',
      width,
      height,
      space: 'srgb',
      channels: 3,
      hasAlpha: false,
      hasProfile: false,
    });
    for (const field of ['exif', 'icc', 'iptc', 'xmp', 'orientation'] as const) {
      expect(metadata[field]).toBeUndefined();
    }
    expect(bytes.equals(await readFile(new URL(name, assets)))).toBe(true);
    const crop = await sharp(bytes)
      .extract({ left: Math.floor(width / 2), top: Math.floor(height / 2), width: 200, height: 200 })
      .png()
      .toBuffer();
    const paper = await sharp(crop).stats();
    expect(paper.isOpaque).toBe(true);
    expect(paper.channels[0].mean).toBeGreaterThan(230);
    expect(paper.channels[0].mean).toBeLessThan(237);
    expect(paper.channels[0].stdev).toBeGreaterThan(0.2);
    expect(paper.channels[0].stdev).toBeLessThan(3);
  });

  it('copies the archived path-only wordmark byte-for-byte without generating a new identity', async () => {
    const original = await readFile(archive);
    expect((await readFile(join(directory, 'stillwood-wordmark.svg'))).equals(original)).toBe(true);
    expect((await readFile(new URL('stillwood-wordmark.svg', assets))).equals(original)).toBe(true);
    expect(original.toString()).toContain('<path fill="#263C35"');
    expect(original.toString()).not.toContain('<text');
  });
});
