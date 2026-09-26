import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, '../..');
const temporary = join(repo, '.local/design');
const data = JSON.parse(await readFile(join(root, 'assets/design-system.json'), 'utf8'));
const selected = process.argv.slice(2);
const brands = data.brands.filter(brand => !selected.length || selected.includes(brand.id));
const browser = await chromium.launch();
await mkdir(temporary, { recursive: true });

try {
  const page = await browser.newPage({ deviceScaleFactor: 1, reducedMotion: 'reduce' });
  for (const brand of brands) {
    const directory = join(root, 'assets', brand.id);
    const names = ['cover-01', 'cover-02', 'cover-03', 'frame-01', 'frame-02', 'frame-03', 'banner', 'poster', 'avatar'];
    const exports = [];
    for (const name of names) {
      const source = join(directory, `${name}.svg`);
      const markup = await readFile(source, 'utf8');
      const [, width, height] = markup.match(/width="(\d+)" height="(\d+)"/);
      await page.setViewportSize({ width: Number(width), height: Number(height) });
      await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
      await page.screenshot({ path: join(directory, `${name}.png`), omitBackground: true });
      const bytes = await readFile(join(directory, `${name}.png`));
      exports.push({ path: `${name}.png`, dimensions: [Number(width), Number(height)], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), transparent: name.startsWith('frame-') });
    }
    for (const [viewport, width, height] of [['desktop', 1440, 1100], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(pathToFileURL(join(root, brand.slug, 'site/index.html')).href, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter(image => image.loading !== 'lazy').map(image => image.decode().catch(() => {})));
      });
      await page.screenshot({ path: join(temporary, `preview-${brand.id}-${viewport}.png`) });
    }
    const manifestFile = join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.exports = exports;
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`已导出 ${brand.id} 的完整封面、透明 Cover、横幅、海报和网站预览。`);
  }
} finally {
  await browser.close();
}

const ids = brands.map(brand => brand.id);
execFileSync('uv', ['run', '--no-project', '--with', 'Pillow==12.3.0', 'python3', '-c', `
import sys
from pathlib import Path
from PIL import Image
root=Path(sys.argv[1])
temporary=root.parent.parent/'.local/design'
for number in sys.argv[2:]:
 for viewport in ('desktop','mobile'):
  source=temporary/f'preview-{number}-{viewport}.png'
  image=Image.open(source).convert('RGB')
  image.save(root/'assets'/number/f'website-{viewport}.webp','WEBP',quality=90,method=6)
`, root, ...ids], { stdio: 'inherit' });

for (const brand of brands) {
  for (const viewport of ['desktop', 'mobile']) {
    const file = join(root, 'assets', brand.id, `website-${viewport}.webp`);
    if (!(await stat(file)).size) throw new Error(`Empty website preview: ${file}`);
  }
}
