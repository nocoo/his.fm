import type { Actor } from '../src/shared/production';
import {
  type StorageCleanupResult,
  type StorageObject,
  storageCleanupSchema,
  storageKeySchema,
  storageKind,
} from '../src/shared/storage';
import { parseWav } from './audio';
import type { AudioSnapshot } from './audio-store';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { rasterType } from './media-validation';
import { readBytes, readJson } from './production-body';
import { mediaUrl } from './production-store';

const retentionMs = 24 * 60 * 60 * 1000;
type References = { keys: Map<string, Set<string>>; prefixes: string[] };

function collect(value: unknown, label: string, keys: References['keys'], property = '') {
  if (typeof value === 'string') {
    const add = (key: string) => {
      const labels = keys.get(key) ?? new Set<string>();
      labels.add(label);
      keys.set(key, labels);
    };
    if (['key', 'introKey', 'outroKey'].includes(property)) add(value);
    for (const match of value.matchAll(/https?:\/\/[^\s<>"'()`[\]]+|\/media\/[^\s<>"'()`[\]]+/g)) {
      try {
        const url = new URL(match[0].replace(/[.,;!，。；！]+$/, ''), 'https://his.fm');
        let path = '';
        if (url.origin === 'https://f.no.mt') path = url.pathname.slice(1);
        else if (
          ['his.fm', 'hisfm.dev.hexly.ai', 'localhost', '127.0.0.1'].includes(url.hostname) &&
          url.pathname.startsWith('/media/')
        )
          path = url.pathname.slice(7);
        if (path) add(decodeURIComponent(path));
      } catch {}
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, label, keys);
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) collect(item, label, keys, name);
  }
}

async function references(db: D1Database): Promise<References> {
  const [productions, episodes, settings, jobs, channel, bumpers, speech, categories] = await db.batch<
    Record<string, unknown>
  >([
    db.prepare('SELECT data FROM productions'),
    db.prepare('SELECT title, cover_url, audio_url, transcript, show_notes, summary FROM episodes'),
    db.prepare('SELECT data FROM production_settings'),
    db.prepare('SELECT snapshot, status FROM audio_jobs'),
    db.prepare('SELECT content, prompts FROM channel_profile'),
    db.prepare('SELECT name, data FROM bumpers'),
    db.prepare('SELECT snapshot FROM speech_jobs'),
    db.prepare('SELECT name, prompt FROM categories'),
  ]);
  const refs: References = { keys: new Map(), prefixes: [] };
  for (const row of productions.results) {
    const data = JSON.parse(String(row.data));
    collect(data, `制作：${data.title}`, refs.keys);
  }
  for (const row of episodes.results) collect(row, `节目：${row.title}`, refs.keys);
  for (const row of settings.results) collect(JSON.parse(String(row.data)), '工作室贴片设置', refs.keys);
  for (const row of bumpers.results) collect(JSON.parse(String(row.data)), `贴片：${row.name}`, refs.keys);
  for (const row of channel.results) collect(row, '频道定位', refs.keys);
  for (const row of categories.results) collect(row.prompt, `栏目：${row.name}`, refs.keys);
  for (const row of jobs.results) {
    const snapshot: AudioSnapshot = JSON.parse(String(row.snapshot));
    if (row.status === 'queued' || row.status === 'running')
      refs.prefixes.push(`audio/${snapshot.productionId}/${snapshot.scriptVersion}/${snapshot.jobId}/`);
    collect(snapshot, '音频任务使用的贴片', refs.keys);
  }
  for (const row of speech.results) collect(JSON.parse(String(row.snapshot)), '语音任务快照', refs.keys);
  return refs;
}

function describe(object: R2Object, refs: References): StorageObject {
  let state: StorageObject['state'] = 'unused';
  let reasons = ['未检测到站内引用'];
  const labels = refs.keys.get(object.key);
  if (labels) {
    state = 'referenced';
    reasons = [...labels];
  } else if (object.key.startsWith('images/') || object.key.startsWith('reference/')) {
    state = 'protected';
    reasons = ['品牌图片与音色参考'];
  } else if (refs.prefixes.some((prefix) => object.key.startsWith(prefix))) {
    state = 'protected';
    reasons = ['音频任务尚未结束'];
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

function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) return null;
  return { offset: start, length: end - start + 1 };
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
  const rangeHeader =
    request.method === 'GET' &&
    (!request.headers.has('If-Range') || request.headers.get('If-Range') === object.httpEtag)
      ? request.headers.get('Range')
      : null;
  const range = rangeHeader ? byteRange(rangeHeader, object.size) : undefined;
  if (range === null) {
    headers.set('Content-Range', `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Length', String(range?.length ?? object.size));
  if (range)
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  if (request.method === 'HEAD') return new Response(null, { headers });
  const content = await env.MEDIA.get(object.key, { range, onlyIf: { etagMatches: object.etag } });
  if (!content || !('body' in content)) throw new HttpError(409, '资源已变化，请重新打开');
  return new Response(content.body, { status: range ? 206 : 200, headers });
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
  return json({ object: describe(object, { keys: new Map(), prefixes: [] }), url: mediaUrl(env, key) }, 201);
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
