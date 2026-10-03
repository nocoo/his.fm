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
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!account || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  const key = asset.key.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/r2/buckets/his-fm/objects/${key}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': asset.contentType,
        'Cache-Control': manifest.cacheControl,
      },
      body: data,
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!response.ok) {
    throw new Error(`R2 upload failed: ${response.status} ${asset.key}`);
  }
  await response.arrayBuffer();
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
