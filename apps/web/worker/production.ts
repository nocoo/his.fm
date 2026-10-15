import { AudioError, hasScope } from '@his-fm/contracts';
import {
  type Actor,
  briefSchema,
  type Production,
  productionActionSchema,
  productionPatchSchema,
  publicationSchema,
} from '../src/shared/production';
import { operationFence, operationReceipt } from './agent-runtime-operation';
import { storeNativeWav } from './audio';
import { requireScope } from './authorization';
import { categoryFence, getCategory } from './categories';
import { getChannel } from './channel';
import { HttpError, json } from './http';
import { rasterType } from './media-validation';
import { readBytes, readJson } from './production-body';
import { applyAction, applyPatch, editAssets, requireFinalAssets, requireStage } from './production-model';
import { productionPrompts } from './production-prompts';
import {
  appendEvent,
  getProduction,
  mediaUrl,
  nextVersion,
  projectProduction,
  updateProduction,
  updateStatement,
} from './production-store';

function versionQuery(request: Request) {
  const value = new URL(request.url).searchParams.get('version');
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new HttpError(400, '请提供当前版本号');
  return Number(value);
}

async function uploadCover(request: Request, env: Env, id: string, actor: Actor) {
  requireScope(actor, 'productions:write');
  requireScope(actor, 'storage:write');
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

function requireIdleAudio(production: Production) {
  if (production.audioJob && ['queued', 'running'].includes(production.audioJob.status))
    throw new HttpError(409, '请等待正在制作的音频完成后再修改素材');
}

async function uploadAudio(request: Request, env: Env, id: string, actor: Actor) {
  requireScope(actor, 'productions:write');
  requireScope(actor, 'storage:write');
  const expectedVersion = versionQuery(request);
  const current = await getProduction(env.DB, id);
  if (current.version !== expectedVersion) throw new HttpError(409, '内容已更新，请刷新后重试');
  requireStage(current, 'production', 'final_review', 'ready');
  editAssets(current, actor);
  requireIdleAudio(current);
  if (!current.approvals.brief || !current.approvals.script || !current.transcript.trim())
    throw new HttpError(409, '请先确认当前逐字稿');
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'audio/wav')
    throw new HttpError(415, '请上传 WAV 音频');
  const key = `productions/${id}/audio-${current.scriptVersion}-${crypto.randomUUID()}.wav`;
  let stored: Awaited<ReturnType<typeof storeNativeWav>>;
  try {
    stored = await storeNativeWav(request, env.MEDIA, key, 1800);
  } catch (error) {
    if (error instanceof AudioError) throw new HttpError(400, error.message);
    throw error;
  }
  try {
    return await updateProduction(
      env.DB,
      id,
      actor,
      'upload_audio',
      (production) => ({
        ...editAssets(production, actor),
        audioJob: null,
        assets: {
          ...production.assets,
          audio: {
            key,
            url: mediaUrl(env, key),
            mimeType: 'audio/wav',
            size: stored.size,
            scriptVersion: production.scriptVersion,
            createdAt: new Date().toISOString(),
            durationSeconds: stored.durationSeconds,
            source: 'upload',
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

async function detachAsset(request: Request, env: Env, id: string, asset: 'cover' | 'audio', actor: Actor) {
  requireScope(actor, 'productions:write');
  requireScope(actor, 'storage:write');
  return updateProduction(
    env.DB,
    id,
    actor,
    `detach_${asset}`,
    (production) => {
      if (asset === 'audio') requireIdleAudio(production);
      return {
        ...editAssets(production, actor),
        assets: { ...production.assets, [asset]: null },
        audioJob: asset === 'audio' ? null : production.audioJob,
      };
    },
    { expectedVersion: versionQuery(request) },
  );
}

export async function publishProduction(
  db: D1Database,
  production: Production,
  input: ReturnType<typeof publicationSchema.parse>,
  actor: Actor,
  correction = false,
) {
  requireScope(actor, 'publications:write');
  requireStage(production, 'ready');
  requireFinalAssets(production);
  if (!production.approvals.final) throw new HttpError(409, '请先完成成品确认');
  if (new Date(input.publishedAt).getTime() > Date.now())
    throw new HttpError(400, '请填写实际已经发布的时间');
  if (input.platform !== 'site') {
    const hostname = new URL(input.url).hostname.toLowerCase();
    const platformHost = input.platform === 'wechat' ? 'mp.weixin.qq.com' : 'xiaoyuzhoufm.com';
    if (hostname !== platformHost && !hostname.endsWith(`.${platformHost}`))
      throw new HttpError(400, '发布链接与所选平台不一致');
  }
  const previous = production.publications.filter((record) => record.platform === input.platform);
  if (correction ? !previous.length : previous.length)
    throw new HttpError(correction ? 404 : 409, correction ? '发布记录不存在' : '请使用发布记录修正接口');
  const next = nextVersion(
    appendEvent(
      {
        ...production,
        publications: [
          ...production.publications.filter((record) => record.platform !== input.platform),
          {
            platform: input.platform,
            url: input.platform === 'site' ? '' : input.url,
            publishedAt: input.publishedAt,
            confirmedAt: new Date().toISOString(),
            confirmedBy: actor.name,
            version: input.version,
          },
        ],
      },
      actor,
      `${correction ? 'correct' : 'record'}_publication:${input.platform}`,
      JSON.stringify({ previous, input }),
    ),
    input.version,
  );
  const eventId = next.events.at(-1)?.id;
  const snapshot = db
    .prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, source_production_id, version)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 0, ?, ?, ?, ?, 1
    WHERE EXISTS (SELECT 1 FROM productions WHERE id = ? AND version = ? AND json_extract(data, '$.events[#-1].id') = ?)
    ON CONFLICT(source_production_id) DO UPDATE SET slug = excluded.slug, episode_number = excluded.episode_number, title = excluded.title, summary = excluded.summary, transcript = excluded.transcript, show_notes = excluded.show_notes, cover_url = excluded.cover_url, category = excluded.category, tags = excluded.tags, duration_seconds = excluded.duration_seconds, audio_url = excluded.audio_url, status = excluded.status, published_at = excluded.published_at, updated_at = excluded.updated_at, version = episodes.version + 1`)
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
    const fence = operationFence(db);
    const results = await db.batch([
      ...fence,
      categoryFence(db, next.category),
      updateStatement(db, next, input.version),
      snapshot,
      ...operationReceipt(db, next),
    ]);
    if (results[fence.length + 1]?.meta.changes !== 1)
      throw new HttpError(409, '内容已更新，请刷新后重新确认发布');
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
      throw new HttpError(409, '公开节目存在相同链接名称或记录标识，尚未登记发布');
    throw error;
  }
  return next;
}

async function withdrawPublication(
  db: D1Database,
  production: Production,
  platform: string,
  version: number,
  actor: Actor,
) {
  requireScope(actor, 'publications:delete');
  const previous = production.publications.filter((record) => record.platform === platform);
  if (!previous.length) throw new HttpError(404, '发布记录不存在');
  const next = nextVersion(
    appendEvent(
      {
        ...production,
        publications: production.publications.filter((record) => record.platform !== platform),
      },
      actor,
      `withdraw_publication:${platform}`,
      JSON.stringify({ previous }),
    ),
    version,
  );
  const publishedAt = next.publications.at(-1)?.publishedAt ?? null;
  const snapshot = db
    .prepare(`UPDATE episodes SET status = ?, published_at = ?, updated_at = ?, version = version + 1
      WHERE source_production_id = ? AND EXISTS (
        SELECT 1 FROM productions WHERE id = ? AND version = ? AND json_extract(data, '$.events[#-1].id') = ?
      )`)
    .bind(
      publishedAt ? 'published' : 'draft',
      publishedAt,
      next.updatedAt,
      next.id,
      next.id,
      next.version,
      next.events.at(-1)?.id,
    );
  const fence = operationFence(db);
  const results = await db.batch([
    ...fence,
    updateStatement(db, next, version),
    snapshot,
    ...operationReceipt(db, next),
  ]);
  if (results[fence.length]?.meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重试');
  return next;
}

export async function routeProductions(
  request: Request,
  env: Env,
  path: string,
  actor: Actor,
): Promise<Response | null> {
  const respond = (production: Production, status = 200) =>
    json({ production: projectProduction(production, actor) }, status);
  if (path === '/productions') {
    if (request.method === 'GET') {
      requireScope(actor, 'productions:read');
      const { results } = await env.DB.prepare('SELECT data FROM productions ORDER BY updated_at DESC').all<{
        data: string;
      }>();
      return json({ productions: results.map((row) => projectProduction(JSON.parse(row.data), actor)) });
    }
    if (request.method === 'POST') {
      requireScope(actor, 'productions:write');
      const brief = await readJson(request, briefSchema);
      await getCategory(env.DB, brief.category);
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
      const insert = env.DB.prepare(
        'INSERT INTO productions (id, version, stage, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(production.id, production.version, production.stage, JSON.stringify(production), now, now);
      await env.DB.batch([
        ...operationFence(env.DB),
        categoryFence(env.DB, brief.category),
        insert,
        ...operationReceipt(env.DB, production),
      ]);
      return respond(production, 201);
    }
    throw new HttpError(405, '不支持这个请求方式');
  }
  const match = path.match(
    /^\/productions\/([^/]+)(?:\/(actions|prompts|assets\/(?:cover|audio)|publications(?:\/(?:site|wechat|xiaoyuzhou))?))?$/,
  );
  if (!match) return null;
  const id = match[1];
  const operation = match[2];
  if (operation === 'assets/cover' && request.method === 'PUT')
    return respond(await uploadCover(request, env, id, actor));
  if (operation === 'assets/audio' && request.method === 'PUT')
    return respond(await uploadAudio(request, env, id, actor));
  if (operation?.startsWith('assets/') && request.method === 'DELETE')
    return respond(
      await detachAsset(request, env, id, operation === 'assets/cover' ? 'cover' : 'audio', actor),
    );
  if (operation === 'actions' && request.method === 'POST') {
    const action = await readJson(request, productionActionSchema);
    const production = await updateProduction(
      env.DB,
      id,
      actor,
      action.action,
      (current) => {
        return applyAction(
          action.changes ? applyPatch(current, action.changes, actor) : current,
          action,
          actor,
        );
      },
      { expectedVersion: action.version, feedback: action.feedback },
    );
    return respond(production);
  }
  if (operation === 'publications' && request.method === 'POST') {
    requireScope(actor, 'publications:write');
    const input = await readJson(request, publicationSchema);
    return respond(await publishProduction(env.DB, await getProduction(env.DB, id), input, actor));
  }
  if (operation === 'publications' && request.method === 'GET') {
    requireScope(actor, 'publications:read');
    return json({ publications: (await getProduction(env.DB, id)).publications });
  }
  if (operation?.startsWith('publications/')) {
    const platform = operation.split('/')[1];
    if (request.method === 'PATCH') {
      requireScope(actor, 'publications:write');
      const input = await readJson(request, publicationSchema);
      if (input.platform !== platform) throw new HttpError(400, '发布平台与路径不一致');
      return respond(await publishProduction(env.DB, await getProduction(env.DB, id), input, actor, true));
    }
    if (request.method === 'DELETE') {
      requireScope(actor, 'publications:delete');
      return respond(
        await withdrawPublication(
          env.DB,
          await getProduction(env.DB, id),
          platform,
          versionQuery(request),
          actor,
        ),
      );
    }
  }
  if (operation === 'prompts' && request.method === 'GET') {
    requireScope(actor, 'productions:read');
    requireScope(actor, 'prompts:read');
    const production = await getProduction(env.DB, id);
    return json(
      productionPrompts(
        {
          ...production,
          events: production.events.filter(
            (event) => hasScope(actor, 'publications:read') || !event.action.includes('publication:'),
          ),
        },
        await getChannel(env.DB),
        await getCategory(env.DB, production.category),
      ),
    );
  }
  if (operation) throw new HttpError(405, '不支持这个请求方式');
  if (request.method === 'GET') {
    requireScope(actor, 'productions:read');
    const production = await getProduction(env.DB, id);
    const categoryProfile = await getCategory(env.DB, production.category);
    const { prompt: _prompt, ...categoryMetadata } = categoryProfile;
    return json({
      production: projectProduction(production, actor),
      categoryProfile: hasScope(actor, 'prompts:read') ? categoryProfile : categoryMetadata,
    });
  }
  if (request.method === 'PUT') {
    requireScope(actor, 'productions:write');
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
    return respond(production);
  }
  if (request.method === 'DELETE') {
    requireScope(actor, 'productions:delete');
    const version = versionQuery(request);
    const production = await getProduction(env.DB, id);
    requireIdleAudio(production);
    if (
      production.publications.length ||
      production.events.some((event) => event.action.includes('publication:'))
    )
      throw new HttpError(409, '已登记发布的制作任务不能删除');
    const deleted = await env.DB.prepare(
      "DELETE FROM productions WHERE id = ? AND version = ? AND json_array_length(data, '$.publications') = 0 AND NOT EXISTS (SELECT 1 FROM episodes WHERE source_production_id = productions.id) RETURNING id",
    )
      .bind(id, version)
      .first();
    if (!deleted) throw new HttpError(409, '内容已更新，请刷新后重试');
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, '不支持这个请求方式');
}
