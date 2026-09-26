import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('artwork/identity/manifest.json', 'utf8'));
const origin = 'https://hisfm.dev.hexly.ai';
const receiptFile = '.local/appearance/r2-uploaded.json';
await mkdir('.local/appearance', { recursive: true });
const receipts = new Set(
  JSON.parse(
    await readFile(receiptFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    }),
  ),
);
let uploaded = 0;

for (const asset of manifest.assets) {
  const data = await readFile(asset.file);
  if (createHash('sha256').update(data).digest('hex') !== asset.sha256) {
    throw new Error(`Local digest mismatch: ${asset.file}`);
  }
  if (receipts.has(asset.key)) continue;
  execFileSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'r2',
      'object',
      'put',
      `his-fm/${asset.key}`,
      '--remote',
      '--config',
      'wrangler.jsonc',
      '--file',
      asset.file,
      '--content-type',
      asset.contentType,
      '--cache-control',
      manifest.cacheControl,
      '--force',
    ],
    {
      env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
      stdio: 'pipe',
      timeout: 90000,
    },
  );
  receipts.add(asset.key);
  await writeFile(receiptFile, `${JSON.stringify([...receipts], null, 2)}\n`);
  uploaded++;
  if (uploaded % 10 === 0) console.log(`R2 已新增 ${uploaded} 个不可变资源。`);
}
console.log(`R2 上传完成，开始验证 ${manifest.assets.length} 个 CDN 资源。`);

let verified = 0;
for (const asset of manifest.assets) {
  const url = `${manifest.cdn}/${asset.key}`;
  const response = await fetch(url, { headers: { Origin: origin }, signal: AbortSignal.timeout(30000) });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== asset.contentType) {
    throw new Error(`CDN content mismatch: ${response.status} ${asset.key}`);
  }
  if (response.headers.get('cache-control') !== manifest.cacheControl) {
    throw new Error(`CDN cache policy mismatch: ${asset.key}`);
  }
  if (![origin, '*'].includes(response.headers.get('access-control-allow-origin'))) {
    throw new Error(`Artwork CORS missing: ${asset.key}`);
  }
  const delivered = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(delivered).digest('hex') !== asset.sha256) {
    throw new Error(`CDN digest mismatch: ${asset.key}`);
  }
  verified++;
  if (verified % 20 === 0 || verified === manifest.assets.length) {
    console.log(`CDN 内容、缓存及跨域已验证 ${verified}/${manifest.assets.length}。`);
  }
}
