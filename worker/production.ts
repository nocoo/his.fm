import {
  type Actor,
  briefSchema,
  type Production,
  productionActionSchema,
  productionPatchSchema,
  publicationSchema,
} from '../src/shared/production';
import { getSettings } from './audio-store';
import { getChannel } from './channel';
import { HttpError, json } from './http';
import { readBytes, readJson } from './production-body';
import {
  applyAction,
  applyPatch,
  editAssets,
  requireFinalAssets,
  requireHuman,
  requireStage,
} from './production-model';
import { productionPrompts } from './production-prompts';
import {
  appendEvent,
  getProduction,
  mediaUrl,
  nextVersion,
  updateProduction,
  updateStatement,
} from './production-store';

function versionQuery(request: Request) {
  const value = new URL(request.url).searchParams.get('version');
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new HttpError(400, '请提供当前版本号');
  return Number(value);
}

function rasterType(bytes: Uint8Array) {
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  if (
    bytes.length >= 45 &&
    bytes[0] === 137 &&
    text(1, 4) === 'PNG' &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10 &&
    text(12, 16) === 'IHDR' &&
    text(bytes.length - 8, bytes.length - 4) === 'IEND'
  )
    return { mime: 'image/png', extension: 'png' };
  if (
    bytes.length >= 16 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return { mime: 'image/jpeg', extension: 'jpg' };
  if (
    bytes.length >= 30 &&
    text(0, 4) === 'RIFF' &&
    text(8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(text(12, 16)) &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length
  )
    return { mime: 'image/webp', extension: 'webp' };
  throw new HttpError(415, '请上传完整的 PNG、JPEG 或 WebP 封面');
}

async function uploadCover(request: Request, env: Env, id: string, actor: Actor) {
  const expectedVersion = versionQuery(request);
  const current = await getProduction(env.DB, id);
  if (current.version !== expectedVersion) throw new HttpError(409, '内容已更新，请刷新后重试');
  editAssets(current, actor);
  const bytes = await readBytes(request, 8 * 1024 * 1024);
  const type = rasterType(bytes);
  if (request.headers.get('Content-Type')?.split(';')[0] !== type.mime)
    throw new HttpError(415, '图片类型与文件内容不一致');
  const key = `productions/${id}/cover-${current.scriptVersion}-${crypto.randomUUID()}.${type.extension}`;
  const object = await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: type.mime, cacheControl: 'public, max-age=31536000, immutable' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (!object) throw new HttpError(409, '素材路径已存在，请重试');
  try {
    return await updateProduction(
      env.DB,
      id,
      actor,
      'upload_cover',
      (production) => ({
        ...editAssets(production, actor),
        assets: {
          ...production.assets,
          cover: {
            key,
            url: mediaUrl(env, key),
            mimeType: type.mime,
            size: bytes.length,
            scriptVersion: production.scriptVersion,
            createdAt: new Date().toISOString(),
          },
        },
      }),
      { expectedVersion },
    );
  } catch (error) {
    await env.MEDIA.delete(key);
    throw error;
  }
}

export async function publishProduction(
  db: D1Database,
  production: Production,
  input: ReturnType<typeof publicationSchema.parse>,
  actor: Actor,
) {
  requireHuman(actor);
  requireStage(production, 'ready');
  requireFinalAssets(production);
  if (!production.approvals.final) throw new HttpError(409, '请先完成人工成品确认');
  if (new Date(input.publishedAt).getTime() > Date.now())
    throw new HttpError(400, '请填写实际已经发布的时间');
  const hostname = new URL(input.url).hostname.toLowerCase();
  const platformHost = input.platform === 'wechat' ? 'mp.weixin.qq.com' : 'xiaoyuzhoufm.com';
  if (hostname !== platformHost && !hostname.endsWith(`.${platformHost}`))
    throw new HttpError(400, '发布链接与所选平台不一致');
  const next = nextVersion(
    appendEvent(
      {
        ...production,
        publications: [
          ...production.publications,
          {
            platform: input.platform,
            url: input.url,
            publishedAt: input.publishedAt,
            confirmedAt: new Date().toISOString(),
            confirmedBy: actor.name,
            version: input.version,
          },
        ],
      },
      actor,
      `record_publication:${input.platform}`,
    ),
    input.version,
  );
  const eventId = next.events.at(-1)?.id;
  const snapshot = db
    .prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, source_production_id)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 0, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM productions WHERE id = ? AND version = ? AND json_extract(data, '$.events[#-1].id') = ?)
    ON CONFLICT(source_production_id) DO UPDATE SET slug = excluded.slug, episode_number = excluded.episode_number, title = excluded.title, summary = excluded.summary, transcript = excluded.transcript, show_notes = excluded.show_notes, cover_url = excluded.cover_url, category = excluded.category, tags = excluded.tags, duration_seconds = excluded.duration_seconds, audio_url = excluded.audio_url, status = excluded.status, published_at = excluded.published_at, updated_at = excluded.updated_at`)
    .bind(
      next.id,
      next.slug,
      next.episodeNumber,
      next.title,
      next.summary,
      next.transcript,
      next.description,
      next.assets.cover?.url,
      next.category,
      JSON.stringify(next.tags),
      next.assets.audio?.durationSeconds,
      next.assets.audio?.url,
      input.publishedAt,
      next.createdAt,
      next.updatedAt,
      next.id,
      next.id,
      next.version,
      eventId,
    );
  try {
    const results = await db.batch([updateStatement(db, next, input.version), snapshot]);
    if (results[0]?.meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重新确认发布');
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
      throw new HttpError(409, '公开节目存在相同链接名称或记录标识，尚未登记发布');
    throw error;
  }
  return next;
}

export async function routeProductions(
  request: Request,
  env: Env,
  path: string,
  actor: Actor,
): Promise<Response | null> {
  if (path === '/productions') {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT data FROM productions ORDER BY updated_at DESC').all<{
        data: string;
      }>();
      return json({ productions: results.map((row) => JSON.parse(row.data) as Production) });
    }
    if (request.method === 'POST') {
      const brief = await readJson(request, briefSchema);
      const now = new Date().toISOString();
      const production = appendEvent(
        {
          ...brief,
          id: crypto.randomUUID(),
          version: 1,
          stage: 'draft',
          transcript: '',
          scriptVersion: 0,
          description: '',
          summary: '',
          assets: { cover: null, audio: null },
          approvals: { brief: null, script: null, final: null },
          audioJob: null,
          publications: [],
          events: [],
          createdAt: now,
          updatedAt: now,
        },
        actor,
        'create',
      );
      await env.DB.prepare(
        'INSERT INTO productions (id, version, stage, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(production.id, production.version, production.stage, JSON.stringify(production), now, now)
        .run();
      return json({ production }, 201);
    }
    throw new HttpError(405, '不支持这个请求方式');
  }
  const match = path.match(/^\/productions\/([^/]+)(?:\/(actions|prompts|assets\/cover|publications))?$/);
  if (!match) return null;
  const id = match[1];
  const operation = match[2];
  if (operation === 'assets/cover' && request.method === 'PUT')
    return json({ production: await uploadCover(request, env, id, actor) });
  if (operation === 'actions' && request.method === 'POST') {
    const action = await readJson(request, productionActionSchema);
    const production = await updateProduction(
      env.DB,
      id,
      actor,
      action.action,
      (current) => {
        if (action.changes) requireHuman(actor);
        return applyAction(
          action.changes ? applyPatch(current, action.changes, actor) : current,
          action,
          actor,
        );
      },
      { expectedVersion: action.version, feedback: action.feedback },
    );
    return json({ production });
  }
  if (operation === 'publications' && request.method === 'POST') {
    requireHuman(actor);
    const input = await readJson(request, publicationSchema);
    return json({
      production: await publishProduction(env.DB, await getProduction(env.DB, id), input, actor),
    });
  }
  if (operation === 'prompts' && request.method === 'GET')
    return json(
      productionPrompts(await getProduction(env.DB, id), await getChannel(env.DB), await getSettings(env)),
    );
  if (operation) throw new HttpError(405, '不支持这个请求方式');
  if (request.method === 'GET') return json({ production: await getProduction(env.DB, id) });
  if (request.method === 'PUT') {
    const patch = await readJson(request, productionPatchSchema);
    const { version, ...fields } = patch;
    const production = await updateProduction(
      env.DB,
      id,
      actor,
      'edit',
      (current) => applyPatch(current, fields, actor),
      { expectedVersion: version },
    );
    return json({ production });
  }
  if (request.method === 'DELETE') {
    const version = versionQuery(request);
    const production = await getProduction(env.DB, id);
    if (production.publications.length) throw new HttpError(409, '已登记发布的制作任务不能删除');
    const deleted = await env.DB.prepare(
      "DELETE FROM productions WHERE id = ? AND version = ? AND json_array_length(data, '$.publications') = 0 RETURNING id",
    )
      .bind(id, version)
      .first();
    if (!deleted) throw new HttpError(409, '内容已更新，请刷新后重试');
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, '不支持这个请求方式');
}
