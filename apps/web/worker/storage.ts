import { isMp3Container, parseMp3 } from '@his-fm/contracts';
import brandAssets from '../src/brand/assets.json';
import voicePreviewManifest from '../src/shared/data/voice-preview-manifest.json';
import type { Actor } from '../src/shared/production';
import {
  type StorageCleanupResult,
  type StorageObject,
  storageCleanupSchema,
  storageKeySchema,
  storageKind,
} from '../src/shared/storage';
import { collectReferenceKeys } from '../src/shared/storage-references';
import { parseVoicePreviewStorageKey } from '../src/shared/voice-preview-prefix';
import { parseWav } from './audio';
import { requireScope } from './authorization';
import { currentArtPrefixes } from './episode-art-cache';
import { HttpError, json } from './http';
import { streamMedia } from './media';
import { rasterType } from './media-validation';
import { readBytes, readJson } from './production-body';
import { mediaUrl } from './production-store';

export const STORAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STORAGE_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const maxScheduledDeletesPerRun = 50;
const gcDeleteChunkSize = 10;
const gcSqlBatchSize = 50;
const immutableUploadCacheControl = 'public, max-age=31536000, immutable';
const voicePreviewReferenceCacheControl = 'public, max-age=300, must-revalidate';

const protectedBrandAssetKeys = new Set<string>(['images/episode-01.webp']);
for (const theme of Object.values(brandAssets)) {
  for (const value of Object.values(theme)) {
    if (typeof value !== 'string') continue;
    for (const key of collectReferenceKeys(value)) protectedBrandAssetKeys.add(key);
  }
}

const protectedVoicePreviewKeys = new Set<string>(voicePreviewManifest.map((entry) => entry.objectKey));

type References = {
  keys: Map<string, Set<string>>;
  artPrefixes: string[];
  gcQueue: Map<string, string>;
};

export type StorageGcSummary = {
  scanned: number;
  enqueued: number;
  dequeued: number;
  deleted: number;
  deletedBytes: number;
  skipped: number;
  failed: number;
};

function collect(value: unknown, label: string, keys: References['keys'], property = '') {
  if (typeof value === 'string') {
    const add = (key: string) => {
      const labels = keys.get(key) ?? new Set<string>();
      labels.add(label);
      keys.set(key, labels);
    };
    if (['key', 'introKey', 'outroKey'].includes(property)) add(value);
    for (const key of collectReferenceKeys(value)) add(key);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, label, keys);
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) collect(item, label, keys, name);
  }
}

async function runBatched(db: D1Database, statements: D1PreparedStatement[]) {
  for (let start = 0; start < statements.length; start += gcSqlBatchSize) {
    await db.batch(statements.slice(start, start + gcSqlBatchSize));
  }
}

async function references(db: D1Database): Promise<References> {
  const [productions, episodes, provenance, channel, bumpers, categories, siteSeo, topics, mentions, gcRows] =
    await db.batch<Record<string, unknown>>([
      db.prepare('SELECT data FROM productions'),
      db.prepare(
        `SELECT title, cover_url, audio_url, transcript, summary, seo, lead, research_note,
      credits, body FROM episodes`,
      ),
      db.prepare('SELECT data FROM media_provenance'),
      db.prepare('SELECT prompt_slots FROM channel_profile'),
      db.prepare('SELECT name, data FROM bumpers'),
      db.prepare('SELECT name, prompt_slots, seo FROM categories'),
      db.prepare('SELECT data FROM site_seo WHERE id = 1'),
      db.prepare('SELECT episode_id, title, detail, source_urls FROM episode_topics'),
      db.prepare('SELECT episode_id, name, description, url FROM episode_mentions'),
      db.prepare('SELECT key, first_unreferenced_at FROM storage_gc_queue'),
    ]);
  if (
    [productions, episodes, provenance, channel, bumpers, categories, siteSeo, topics, mentions, gcRows].some(
      (result) => !result.success,
    )
  )
    throw new HttpError(503, '资源引用暂时无法读取，请重试');
  const gcQueue = new Map<string, string>();
  for (const row of gcRows.results) {
    gcQueue.set(String(row.key), String(row.first_unreferenced_at));
  }
  const refs: References = { keys: new Map(), artPrefixes: await currentArtPrefixes(db), gcQueue };
  for (const row of productions.results) {
    const data = JSON.parse(String(row.data));
    collect(data, `制作：${data.title}`, refs.keys);
  }
  for (const { seo, ...row } of episodes.results) {
    collect(row, `节目：${row.title}`, refs.keys);
    collect(JSON.parse(String(seo)), `节目 SEO：${row.title}`, refs.keys);
  }
  for (const row of provenance.results) collect(JSON.parse(String(row.data)), '历史音频素材', refs.keys);
  for (const row of bumpers.results) collect(JSON.parse(String(row.data)), `贴片：${row.name}`, refs.keys);
  for (const row of channel.results) collect(JSON.parse(String(row.prompt_slots)), '频道定位', refs.keys);
  for (const row of categories.results) {
    collect(JSON.parse(String(row.prompt_slots)), `栏目：${row.name}`, refs.keys);
    collect(JSON.parse(String(row.seo)), `栏目 SEO：${row.name}`, refs.keys);
  }
  for (const row of siteSeo.results) collect(JSON.parse(String(row.data)), '站点 SEO', refs.keys);
  for (const row of topics.results)
    collect(
      { title: row.title, detail: row.detail, source_urls: JSON.parse(String(row.source_urls)) },
      `听点：${row.title}`,
      refs.keys,
    );
  for (const row of mentions.results)
    collect({ name: row.name, description: row.description, url: row.url }, `来源：${row.name}`, refs.keys);
  return refs;
}

function isStagingUploadKey(key: string) {
  return key.startsWith('uploads/');
}

function purgeTimestamp(object: R2Object, gcQueue: Map<string, string>): string | null {
  if (isStagingUploadKey(object.key)) {
    return new Date(object.uploaded.getTime() + STORAGE_RETENTION_MS).toISOString();
  }
  const queuedAt = gcQueue.get(object.key);
  return queuedAt ? new Date(Date.parse(queuedAt) + STORAGE_GC_GRACE_MS).toISOString() : null;
}

function describe(object: R2Object, refs: References, nowMs = Date.now()): StorageObject {
  let state: StorageObject['state'] = 'unused';
  let reasons = ['未检测到站内引用'];
  const labels = refs.keys.get(object.key);
  if (labels) {
    state = 'referenced';
    reasons = [...labels];
  } else if (refs.artPrefixes.some((prefix) => object.key.startsWith(prefix))) {
    state = 'referenced';
    reasons = ['当前节目合成图片'];
  } else if (protectedVoicePreviewKeys.has(object.key)) {
    state = 'protected';
    reasons = ['音色预览参考样片'];
  } else if (protectedBrandAssetKeys.has(object.key)) {
    state = 'protected';
    reasons = ['品牌与主题运行期资源'];
  } else if (nowMs - object.uploaded.getTime() < STORAGE_RETENTION_MS) {
    state = 'recent';
    reasons = ['上传未满 24 小时'];
  }
  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  return {
    key: object.key,
    version: object.version,
    size: object.size,
    uploaded: object.uploaded.toISOString(),
    contentType,
    kind: storageKind(object.key, contentType),
    state,
    reasons,
    ...(state === 'unused' ? { purgeAfter: purgeTimestamp(object, refs.gcQueue) } : {}),
  };
}

export async function runStorageGc(
  env: Env,
  options: { nowMs?: number; maxDeletes?: number } = {},
): Promise<StorageGcSummary> {
  const nowMs = options.nowMs ?? Date.now();
  const maxDeletes = options.maxDeletes ?? maxScheduledDeletesPerRun;
  const nowIso = new Date(nowMs).toISOString();

  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({ limit: 1000, cursor, include: ['httpMetadata'] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const refs = await references(env.DB);
  const seenKeys = new Set<string>();
  const toEnqueue: string[] = [];
  const toDequeue: string[] = [];
  const due: { key: string; version: string; size: number }[] = [];

  for (const object of objects) {
    seenKeys.add(object.key);
    const info = describe(object, refs, nowMs);
    if (info.state !== 'unused') {
      if (refs.gcQueue.has(object.key)) toDequeue.push(object.key);
      continue;
    }
    if (isStagingUploadKey(object.key)) {
      due.push({ key: object.key, version: object.version, size: object.size });
      continue;
    }
    const queuedAt = refs.gcQueue.get(object.key);
    if (!queuedAt) {
      toEnqueue.push(object.key);
    } else if (Date.parse(queuedAt) + STORAGE_GC_GRACE_MS <= nowMs) {
      due.push({ key: object.key, version: object.version, size: object.size });
    }
  }
  for (const queuedKey of refs.gcQueue.keys()) {
    if (!seenKeys.has(queuedKey)) toDequeue.push(queuedKey);
  }

  const syncStatements: D1PreparedStatement[] = [
    ...toEnqueue.map((key) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO storage_gc_queue (key, first_unreferenced_at) VALUES (?, ?)',
      ).bind(key, nowIso),
    ),
    ...toDequeue.map((key) => env.DB.prepare('DELETE FROM storage_gc_queue WHERE key = ?').bind(key)),
  ];
  await runBatched(env.DB, syncStatements);

  let deleted = 0;
  let deletedBytes = 0;
  let skipped = 0;
  let failed = 0;
  const deletedKeys: string[] = [];
  const candidates = due.slice(0, maxDeletes);

  for (let start = 0; start < candidates.length; start += gcDeleteChunkSize) {
    const chunk = candidates.slice(start, start + gcDeleteChunkSize);
    const freshRefs = await references(env.DB);
    for (const item of chunk) {
      try {
        const object = await env.MEDIA.head(item.key);
        const current = object ? describe(object, freshRefs, nowMs) : null;
        const stillDue =
          current?.state === 'unused' &&
          current.version === item.version &&
          current.purgeAfter != null &&
          Date.parse(current.purgeAfter) <= nowMs;
        if (!stillDue) {
          skipped++;
          continue;
        }
        await env.MEDIA.delete(item.key);
        deleted++;
        deletedBytes += current.size;
        deletedKeys.push(item.key);
      } catch {
        failed++;
      }
    }
  }

  await runBatched(
    env.DB,
    deletedKeys.map((key) => env.DB.prepare('DELETE FROM storage_gc_queue WHERE key = ?').bind(key)),
  );

  const summary: StorageGcSummary = {
    scanned: objects.length,
    enqueued: toEnqueue.length,
    dequeued: toDequeue.length,
    deleted,
    deletedBytes,
    skipped,
    failed,
  };
  console.info(JSON.stringify({ event: 'storage_gc_completed', ...summary }));
  return summary;
}

async function cleanup(env: Env, items: { key: string; version: string }[]) {
  await references(env.DB);
  const results: StorageCleanupResult['results'] = [];
  for (const item of new Map(items.map((item) => [item.key, item])).values()) {
    try {
      const refs = await references(env.DB);
      const object = await env.MEDIA.head(item.key);
      const current = object ? describe(object, refs) : null;
      if (!current || current.version !== item.version || current.state !== 'unused') {
        results.push({
          key: item.key,
          status: 'skipped',
          reason: !current
            ? '文件已不存在'
            : current.version !== item.version
              ? '文件已被替换，请重新扫描'
              : current.reasons.join('；'),
          bytes: 0,
        });
        continue;
      }
      await env.MEDIA.delete(item.key);
      await env.DB.prepare('DELETE FROM storage_gc_queue WHERE key = ?').bind(item.key).run();
      results.push({ key: item.key, status: 'deleted', reason: '已删除', bytes: current.size });
    } catch {
      results.push({ key: item.key, status: 'failed', reason: '删除失败，请重新扫描后重试', bytes: 0 });
    }
  }
  return json({ results } satisfies StorageCleanupResult);
}

async function preview(request: Request, env: Env) {
  const parsed = storageKeySchema.safeParse(new URL(request.url).searchParams.get('key'));
  if (!parsed.success) throw new HttpError(400, '请选择一个资源');
  const object = await env.MEDIA.head(parsed.data);
  if (!object) throw new HttpError(404, '资源不存在');
  const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const inline = /^(image\/(png|jpeg|webp|avif|gif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(type);
  const headers = new Headers({
    'Content-Type': inline ? type : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(object.key.split('/').pop() ?? 'download')}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
  });
  return streamMedia(request, env.MEDIA, object, headers);
}

async function upload(request: Request, env: Env) {
  const url = new URL(request.url);
  const keyQuery = url.searchParams.get('key');
  const namedKey = parseVoicePreviewStorageKey(keyQuery);
  if (keyQuery) {
    if (url.searchParams.size !== 1 || !namedKey) throw new HttpError(400, '音色预览路径无效');
  } else if (url.searchParams.size > 0) {
    throw new HttpError(400, '上传路径由服务器生成');
  }
  const contentType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (namedKey) {
    if (contentType !== 'audio/mpeg') throw new HttpError(415, '音色预览样片请上传 MP3');
  } else if (
    !contentType ||
    !['image/png', 'image/jpeg', 'image/webp', 'audio/wav', 'audio/mpeg'].includes(contentType)
  ) {
    throw new HttpError(415, '请上传 PNG、JPEG、WebP、PCM WAV 或 MP3');
  }
  const bytes = await readBytes(request, 25 * 1024 * 1024);
  let type: { mime: string; extension: string };
  if (contentType === 'audio/wav') {
    try {
      const wav = parseWav(bytes);
      if (wav.dataOffset + wav.dataBytes !== bytes.length) throw new Error('Incomplete WAV');
    } catch {
      throw new HttpError(415, '请上传完整的 24 kHz 单声道 16-bit PCM WAV');
    }
    type = { mime: 'audio/wav', extension: 'wav' };
  } else if (contentType === 'audio/mpeg') {
    try {
      if (!isMp3Container(bytes)) throw new Error('Invalid MP3');
      parseMp3(bytes);
    } catch {
      throw new HttpError(415, '请上传完整的 MP3');
    }
    type = { mime: 'audio/mpeg', extension: 'mp3' };
  } else {
    type = rasterType(bytes);
  }
  if (contentType !== type.mime) throw new HttpError(415, '媒体类型与文件内容不一致');
  const key = namedKey ?? `uploads/${crypto.randomUUID()}.${type.extension}`;
  const object = await env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType: type.mime,
      cacheControl: namedKey ? voicePreviewReferenceCacheControl : immutableUploadCacheControl,
    },
    ...(namedKey ? {} : { onlyIf: { etagDoesNotMatch: '*' } }),
  });
  if (!object) throw new HttpError(409, '资源路径已存在，请重试');
  return json(
    {
      object: describe(object, { keys: new Map(), artPrefixes: [], gcQueue: new Map() }),
      url: mediaUrl(env, key),
    },
    201,
  );
}

export async function routeStorage(request: Request, env: Env, actor: Actor) {
  const url = new URL(request.url);
  requireScope(
    actor,
    ['GET', 'HEAD'].includes(request.method)
      ? 'storage:read'
      : request.method === 'POST' && url.pathname.endsWith('/storage')
        ? 'storage:write'
        : 'storage:delete',
  );
  if (url.pathname === '/admin/api/storage/cleanup') {
    if (request.method !== 'POST') throw new HttpError(405, '请使用 POST 清理资源');
    return cleanup(env, (await readJson(request, storageCleanupSchema)).items);
  }
  if (url.pathname === '/admin/api/storage/object') {
    if (request.method === 'DELETE') {
      const item = storageCleanupSchema.safeParse({
        items: [{ key: url.searchParams.get('key'), version: url.searchParams.get('version') }],
      });
      if (!item.success) throw new HttpError(400, '请提供资源路径与版本');
      return cleanup(env, item.data.items);
    }
    if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '不支持这个请求方式');
    return preview(request, env);
  }
  if (url.pathname !== '/admin/api/storage') throw new HttpError(404, '接口不存在');
  if (request.method === 'POST') return upload(request, env);
  if (request.method !== 'GET') throw new HttpError(405, '请使用 GET 扫描资源');
  const cursor = url.searchParams.get('cursor') ?? undefined;
  if (cursor && cursor.length > 4096) throw new HttpError(400, '扫描游标无效');
  const [page, refs] = await Promise.all([
    env.MEDIA.list({ limit: 200, cursor, include: ['httpMetadata'] }),
    references(env.DB),
  ]);
  return json({
    objects: page.objects.map((object) => describe(object, refs)),
    cursor: page.truncated ? page.cursor : null,
  });
}
