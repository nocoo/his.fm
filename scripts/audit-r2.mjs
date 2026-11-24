import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WEB_DIR = fileURLToPath(new URL('../apps/web', import.meta.url));
const D1_ID = '66f7e201-22a8-450d-838d-ecbc382afbc6';
const BUCKET = 'his-fm';
const RETENTION_MS = 24 * 60 * 60 * 1000;
const GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function runCf(args) {
  const stdout = execFileSync('npx', ['cf', ...args, '-q'], {
    cwd: WEB_DIR,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = stdout.search(/[[{]/);
  if (start === -1) throw new Error(`Unexpected cf output: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
}

function listAllR2Objects() {
  const objects = [];
  let startAfter;
  while (true) {
    const args = ['r2', 'objects', 'list', '--bucket-name', BUCKET, '--per-page', '1000'];
    if (startAfter) args.push('--start-after', startAfter);
    const page = runCf(args);
    if (!Array.isArray(page) || page.length === 0) break;
    objects.push(...page);
    if (page.length < 1000) break;
    startAfter = page[page.length - 1].key;
  }
  return objects;
}

function queryD1(sql) {
  const res = runCf(['d1', 'query', D1_ID, '--sql', sql]);
  return Array.isArray(res) ? (res[0]?.results ?? []) : (res.results ?? []);
}

function collectTextKeys(text, target) {
  for (const match of text.matchAll(
    /https?:\/\/[^\s<>"'()`[\]（）]+|\/(?:media|images)\/[^\s<>"'()`[\]（）]+/g,
  )) {
    const token = match[0].replace(/[.,;!，。；！]+$/, '');
    try {
      const url = new URL(token, 'https://his.fm');
      let key = '';
      if (url.origin === 'https://f.no.mt') key = url.pathname.slice(1);
      else if (['his.fm', 'hisfm.dev.hexly.ai', 'localhost', '127.0.0.1'].includes(url.hostname)) {
        if (url.pathname.startsWith('/media/')) key = url.pathname.slice(7);
        else if (url.pathname.startsWith('/images/')) key = url.pathname.slice(1);
      }
      if (key) target.add(decodeURIComponent(key));
    } catch {
      // Ignore malformed URLs in prose.
    }
  }
}

function collectValueKeys(value, target, prop = '') {
  if (typeof value === 'string') {
    if (['key', 'introKey', 'outroKey'].includes(prop)) target.add(value);
    collectTextKeys(value, target);
  } else if (Array.isArray(value)) {
    for (const item of value) collectValueKeys(item, target);
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) collectValueKeys(item, target, name);
  }
}

function loadStaticAllowlists() {
  const brandAssets = JSON.parse(
    readFileSync(new URL('../apps/web/src/brand/assets.json', import.meta.url), 'utf8'),
  );
  const brandKeys = new Set(['images/episode-01.webp']);
  for (const theme of Object.values(brandAssets)) {
    for (const val of Object.values(theme)) {
      if (typeof val === 'string') collectTextKeys(val, brandKeys);
    }
  }
  const voiceManifest = JSON.parse(
    readFileSync(new URL('../apps/web/src/shared/data/voice-preview-manifest.json', import.meta.url), 'utf8'),
  );
  const voiceKeys = new Set(voiceManifest.map((item) => item.objectKey));
  const layouts = JSON.parse(
    readFileSync(new URL('../apps/web/src/brand/cover-frame-layouts.json', import.meta.url), 'utf8'),
  );
  return { brandKeys, voiceKeys, layouts };
}

function artPrefixes(episodes, productions, categories, theme, layouts) {
  const catNames = new Map(categories.map((c) => [c.id, c.name]));
  const frameDigest = layouts.themes[theme]?.frameDigest ?? '';
  const digest = (inputs) =>
    createHash('sha256')
      .update(JSON.stringify(['jpeg-v1', ...inputs]))
      .digest('hex');
  const prefixes = new Set();
  const add = (rec) => {
    prefixes.add(
      `rendered/art/${theme}/${digest([rec.coverUrl, theme, rec.title, rec.episodeNumber, rec.categoryName, frameDigest])}/`,
    );
    prefixes.add(`rendered/share/${digest([rec.coverUrl])}/`);
  };
  for (const ep of episodes) {
    add({
      coverUrl: ep.cover_url,
      title: ep.title,
      episodeNumber: ep.episode_number,
      categoryName: catNames.get(ep.category) ?? '',
    });
  }
  for (const row of productions) {
    const prod = JSON.parse(String(row.data));
    if (!prod.assets?.cover) continue;
    add({
      coverUrl: prod.assets.cover.url,
      title: prod.title,
      episodeNumber: prod.episodeNumber,
      categoryName: catNames.get(prod.category) ?? '',
    });
  }
  return [...prefixes];
}

function formatMB(bytes) {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

const objects = listAllR2Objects();
const { brandKeys, voiceKeys, layouts } = loadStaticAllowlists();
const productions = queryD1('SELECT data FROM productions');
const episodes = queryD1(
  'SELECT id, title, episode_number, category, cover_url, audio_url, transcript, summary, seo, lead, research_note, credits, body FROM episodes',
);
const provenance = queryD1('SELECT data FROM media_provenance');
const channel = queryD1('SELECT prompt_slots FROM channel_profile');
const bumpers = queryD1('SELECT name, data FROM bumpers');
const categories = queryD1('SELECT id, name, prompt_slots, seo FROM categories');
const siteSeo = queryD1('SELECT data FROM site_seo WHERE id = 1');
const topics = queryD1('SELECT title, detail, source_urls FROM episode_topics');
const mentions = queryD1('SELECT name, description, url FROM episode_mentions');
const appearance = queryD1('SELECT theme FROM site_appearance WHERE id = 1');
const gcRows = (() => {
  try {
    return queryD1('SELECT key, first_unreferenced_at FROM storage_gc_queue');
  } catch {
    return [];
  }
})();

const refKeys = new Set();
for (const row of productions) collectValueKeys(JSON.parse(String(row.data)), refKeys);
for (const { seo, ...row } of episodes) {
  collectValueKeys(row, refKeys);
  if (seo) collectValueKeys(JSON.parse(String(seo)), refKeys);
}
for (const row of provenance) collectValueKeys(JSON.parse(String(row.data)), refKeys);
for (const row of bumpers) collectValueKeys(JSON.parse(String(row.data)), refKeys);
for (const row of channel)
  if (row.prompt_slots) collectValueKeys(JSON.parse(String(row.prompt_slots)), refKeys);
for (const row of categories) {
  if (row.prompt_slots) collectValueKeys(JSON.parse(String(row.prompt_slots)), refKeys);
  if (row.seo) collectValueKeys(JSON.parse(String(row.seo)), refKeys);
}
for (const row of siteSeo) collectValueKeys(JSON.parse(String(row.data)), refKeys);
for (const row of topics) {
  collectValueKeys(
    { title: row.title, detail: row.detail, source_urls: JSON.parse(String(row.source_urls)) },
    refKeys,
  );
}
for (const row of mentions) collectValueKeys(row, refKeys);

const theme = appearance[0]?.theme ?? 'stillwood';
const currentRendered = artPrefixes(episodes, productions, categories, theme, layouts);
const gcQueue = new Map(gcRows.map((row) => [String(row.key), String(row.first_unreferenced_at)]));
const nowMs = Date.now();

const totals = { referenced: [0, 0], protected: [0, 0], recent: [0, 0], unused: [0, 0], dueNow: [0, 0] };
const byPrefix = new Map();

for (const obj of objects) {
  const prefix = obj.key.includes('/') ? `${obj.key.split('/')[0]}/` : '(root)';
  const p = byPrefix.get(prefix) ?? { count: 0, bytes: 0, unusedCount: 0, unusedBytes: 0 };
  p.count++;
  p.bytes += obj.size;
  let state = 'unused';
  if (refKeys.has(obj.key) || currentRendered.some((prefixItem) => obj.key.startsWith(prefixItem))) {
    state = 'referenced';
  } else if (voiceKeys.has(obj.key) || brandKeys.has(obj.key)) {
    state = 'protected';
  } else if (nowMs - Date.parse(obj.last_modified) < RETENTION_MS) {
    state = 'recent';
  }
  totals[state][0]++;
  totals[state][1] += obj.size;
  if (state === 'unused') {
    p.unusedCount++;
    p.unusedBytes += obj.size;
    const queued = gcQueue.get(obj.key);
    const due = obj.key.startsWith('uploads/') || (queued && Date.parse(queued) + GC_GRACE_MS <= nowMs);
    if (due) {
      totals.dueNow[0]++;
      totals.dueNow[1] += obj.size;
    }
  }
  byPrefix.set(prefix, p);
}

const totalBytes = objects.reduce((sum, obj) => sum + obj.size, 0);
console.log(
  `R2 bucket ${BUCKET}: ${objects.length} objects, ${formatMB(totalBytes)} (${(totalBytes / 1024 ** 3).toFixed(3)} GiB)`,
);
console.log(`  referenced: ${totals.referenced[0]} (${formatMB(totals.referenced[1])})`);
console.log(`  protected:  ${totals.protected[0]} (${formatMB(totals.protected[1])})`);
console.log(`  recent:     ${totals.recent[0]} (${formatMB(totals.recent[1])})`);
console.log(
  `  unused:     ${totals.unused[0]} (${formatMB(totals.unused[1])}), due for auto-GC: ${totals.dueNow[0]} (${formatMB(totals.dueNow[1])})`,
);
console.log('\nBy prefix:');
for (const [prefix, stats] of [...byPrefix.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(
    `  ${prefix.padEnd(15)} total=${String(stats.count).padStart(4)} (${formatMB(stats.bytes).padStart(10)})  unused=${String(stats.unusedCount).padStart(4)} (${formatMB(stats.unusedBytes).padStart(10)})`,
  );
}
