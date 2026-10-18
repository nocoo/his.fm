import type { Actor } from '../src/shared/production';
import {
  type StorageCleanupResult,
  type StorageObject,
  storageCleanupSchema,
  storageKeySchema,
  storageKind,
} from '../src/shared/storage';
import { collectReferenceKeys } from '../src/shared/storage-references';
import { parseWav } from './audio';
import { requireScope } from './authorization';
import { currentArtPrefixes } from './episode-art-cache';
import { HttpError, json } from './http';
import { streamMedia } from './media';
import { rasterType } from './media-validation';
import { readBytes, readJson } from './production-body';
import { mediaUrl } from './production-store';

const retentionMs = 24 * 60 * 60 * 1000;
type References = { keys: Map<string, Set<string>>; artPrefixes: string[] };

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

async function references(db: D1Database): Promise<References> {
  const [productions, episodes, provenance, channel, bumpers, categories, siteSeo] = await db.batch<
    Record<string, unknown>
  >([
    db.prepare('SELECT data FROM productions'),
    db.prepare(
      'SELECT title, cover_url, audio_url, transcript, show_notes, summary, seo, mentions FROM episodes',
    ),
    db.prepare('SELECT data FROM media_provenance'),
    db.prepare('SELECT content, prompts, prompt_slots FROM channel_profile'),
    db.prepare('SELECT name, data FROM bumpers'),
    db.prepare('SELECT name, prompt, prompt_slots, seo FROM categories'),
    db.prepare('SELECT data FROM site_seo WHERE id = 1'),
  ]);
  if (
    [productions, episodes, provenance, channel, bumpers, categories, siteSeo].some(
      (result) => !result.success,
    )
  )
    throw new HttpError(503, '资源引用暂时无法读取，请重试');
  const refs: References = { keys: new Map(), artPrefixes: await currentArtPrefixes(db) };
  for (const row of productions.results) {
    const data = JSON.parse(String(row.data));
    collect(data, `制作：${data.title}`, refs.keys);
  }
  for (const { seo, mentions, ...row } of episodes.results) {
    collect({ ...row, mentions: JSON.parse(String(mentions)) }, `节目：${row.title}`, refs.keys);
    collect(JSON.parse(String(seo)), `节目 SEO：${row.title}`, refs.keys);
  }
  for (const row of provenance.results) collect(JSON.parse(String(row.data)), '历史音频素材', refs.keys);
  for (const row of bumpers.results) collect(JSON.parse(String(row.data)), `贴片：${row.name}`, refs.keys);
  for (const { prompts, prompt_slots, ...row } of channel.results)
    collect(
      { ...row, prompts: JSON.parse(String(prompts)), prompt_slots: JSON.parse(String(prompt_slots)) },
      '频道定位',
      refs.keys,
    );
  for (const row of categories.results) {
    collect(row.prompt, `栏目：${row.name}`, refs.keys);
    collect(JSON.parse(String(row.prompt_slots)), `栏目：${row.name}`, refs.keys);
    collect(JSON.parse(String(row.seo)), `栏目 SEO：${row.name}`, refs.keys);
  }
  for (const row of siteSeo.results) collect(JSON.parse(String(row.data)), '站点 SEO', refs.keys);
  return refs;
}

function describe(object: R2Object, refs: References): StorageObject {
  let state: StorageObject['state'] = 'unused';
  let reasons = ['未检测到站内引用'];
  const labels = refs.keys.get(object.key);
  if (labels) {
    state = 'referenced';
    reasons = [...labels];
  } else if (refs.artPrefixes.some((prefix) => object.key.startsWith(prefix))) {
    state = 'referenced';
    reasons = ['当前节目合成图片'];
  } else if (object.key.startsWith('images/') || object.key.startsWith('reference/')) {
    state = 'protected';
    reasons = ['品牌图片与音色参考'];
  } else if (Date.now() - object.uploaded.getTime() < retentionMs) {
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
  };
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
  if ([...new URL(request.url).searchParams].length) throw new HttpError(400, '上传路径由服务器生成');
  const contentType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (!contentType || !['image/png', 'image/jpeg', 'image/webp', 'audio/wav'].includes(contentType))
    throw new HttpError(415, '请上传 PNG、JPEG、WebP 或 PCM WAV');
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
  } else {
    type = rasterType(bytes);
  }
  if (contentType !== type.mime) throw new HttpError(415, '媒体类型与文件内容不一致');
  const key = `uploads/${crypto.randomUUID()}.${type.extension}`;
  const object = await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: type.mime, cacheControl: 'public, max-age=31536000, immutable' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (!object) throw new HttpError(409, '资源路径已存在，请重试');
  return json(
    { object: describe(object, { keys: new Map(), artPrefixes: [] }), url: mediaUrl(env, key) },
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
