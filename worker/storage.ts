import {
  type StorageCleanupResult,
  type StorageObject,
  storageCleanupSchema,
  storageKeySchema,
  storageKind,
} from '../src/shared/storage';
import type { AudioSnapshot } from './audio-store';
import { HttpError, json } from './http';
import { readJson } from './production-body';

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
  const [productions, episodes, settings, jobs, channel] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT data FROM productions'),
    db.prepare('SELECT title, cover_url, audio_url, transcript, show_notes, summary FROM episodes'),
    db.prepare('SELECT data FROM production_settings'),
    db.prepare("SELECT snapshot FROM audio_jobs WHERE status IN ('queued', 'running')"),
    db.prepare('SELECT content FROM channel_profile'),
  ]);
  const refs: References = { keys: new Map(), prefixes: [] };
  for (const row of productions.results) {
    const data = JSON.parse(String(row.data));
    collect(data, `制作：${data.title}`, refs.keys);
  }
  for (const row of episodes.results) collect(row, `节目：${row.title}`, refs.keys);
  for (const row of settings.results) collect(JSON.parse(String(row.data)), '工作室贴片设置', refs.keys);
  for (const row of channel.results) collect(row, '频道定位', refs.keys);
  for (const row of jobs.results) {
    const snapshot: AudioSnapshot = JSON.parse(String(row.snapshot));
    refs.prefixes.push(`audio/${snapshot.productionId}/${snapshot.scriptVersion}/${snapshot.jobId}/`);
    collect(snapshot, '音频任务使用的贴片', refs.keys);
  }
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

async function cleanup(request: Request, env: Env) {
  const { items } = await readJson(request, storageCleanupSchema);
  const refs = await references(env.DB);
  const results: StorageCleanupResult['results'] = [];
  for (const item of new Map(items.map((item) => [item.key, item])).values()) {
    try {
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

export async function routeStorage(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === '/admin/api/storage/cleanup') {
    if (request.method !== 'POST') throw new HttpError(405, '请使用 POST 清理资源');
    return cleanup(request, env);
  }
  if (url.pathname === '/admin/api/storage/object') {
    if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '不支持这个请求方式');
    return preview(request, env);
  }
  if (url.pathname !== '/admin/api/storage') throw new HttpError(404, '接口不存在');
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
