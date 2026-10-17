import { AudioError, hasScope } from '@his-fm/contracts';
import {
  type Actor,
  briefCreateSchema,
  type Production,
  productionActionSchema,
  productionAudioBindSchema,
  productionPatchSchema,
  publicationSchema,
} from '../src/shared/production';
import {
  adoptProductionAudioUpload,
  PRODUCTION_AUDIO_MAX_DURATION_SECONDS,
  type ProductionAudioMime,
  productionAudioExtension,
  productionAudioObjectKey,
  storeUploadedProductionAudio,
} from './audio';
import { requireScope } from './authorization';
import { categoryFence, getCategory } from './categories';
import { getChannel } from './channel';
import {
  assertEpisodeNumberAvailable,
  deleteHolderEpisodeNumberClaims,
  insertEpisodeNumberClaim,
  nextEpisodeNumberInCategory,
  resolveProductionPatchEpisodeNumber,
  syncEpisodeClaimFromRow,
} from './episode-numbering';
import { HttpError, json } from './http';
import { rasterType } from './media-validation';
import { readBytes, readJson } from './production-body';
import { applyAction, applyPatch, editAssets, requireFinalAssets, requireStage } from './production-model';
import { productionPrompts } from './production-prompts';
import {
  appendEvent,
  getProduction,
  hydrateProduction,
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

async function attachProductionAudio(
  env: Env,
  id: string,
  actor: Actor,
  expectedVersion: number,
  key: string,
  stored: { size: number; durationSeconds: number; mimeType: ProductionAudioMime },
) {
  return updateProduction(
    env.DB,
    id,
    actor,
    'upload_audio',
    (production) => ({
      ...editAssets(production, actor),
      assets: {
        ...production.assets,
        audio: {
          key,
          url: mediaUrl(env, key),
          mimeType: stored.mimeType,
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
}

async function uploadAudio(request: Request, env: Env, id: string, actor: Actor) {
  requireScope(actor, 'productions:write');
  requireScope(actor, 'storage:write');
  const expectedVersion = versionQuery(request);
  const current = await getProduction(env.DB, id);
  if (current.version !== expectedVersion) throw new HttpError(409, '内容已更新，请刷新后重试');
  requireStage(current, 'production', 'final_review', 'ready');
  editAssets(current, actor);
  if (!current.approvals.brief || !current.approvals.script || !current.transcript.trim())
    throw new HttpError(409, '请先确认当前逐字稿');
  const contentType = request.headers.get('Content-Type')?.split(';')[0];
  if (contentType !== 'audio/wav' && contentType !== 'audio/mpeg') {
    throw new HttpError(415, '请上传 WAV 或 MP3 音频');
  }
  const mimeType = contentType as ProductionAudioMime;
  const key = productionAudioObjectKey(
    id,
    current.scriptVersion,
    undefined,
    productionAudioExtension(mimeType),
  );
  let stored: Awaited<ReturnType<typeof storeUploadedProductionAudio>>;
  try {
    stored = await storeUploadedProductionAudio(
      request,
      env.MEDIA,
      key,
      PRODUCTION_AUDIO_MAX_DURATION_SECONDS,
      mimeType,
    );
  } catch (error) {
    if (error instanceof AudioError) throw new HttpError(400, error.message);
    throw error;
  }
  try {
    return await attachProductionAudio(env, id, actor, expectedVersion, key, stored);
  } catch (error) {
    await env.MEDIA.delete(key);
    throw error;
  }
}

async function bindAudio(request: Request, env: Env, id: string, actor: Actor) {
  requireScope(actor, 'productions:write');
  requireScope(actor, 'storage:write');
  const input = await readJson(request, productionAudioBindSchema);
  const expectedVersion = input.version;
  const current = await getProduction(env.DB, id);
  if (current.version !== expectedVersion) throw new HttpError(409, '内容已更新，请刷新后重试');
  requireStage(current, 'production', 'final_review', 'ready');
  editAssets(current, actor);
  if (!current.approvals.brief || !current.approvals.script || !current.transcript.trim())
    throw new HttpError(409, '请先确认当前逐字稿');
  let adopted: Awaited<ReturnType<typeof adoptProductionAudioUpload>>;
  try {
    adopted = await adoptProductionAudioUpload(env.MEDIA, id, current.scriptVersion, input.key);
  } catch (error) {
    if (error instanceof AudioError)
      throw new HttpError(
        error.message.includes('不存在') ? 404 : /已存在|不匹配/.test(error.message) ? 409 : 400,
        error.message,
      );
    throw error;
  }
  try {
    return await attachProductionAudio(env, id, actor, expectedVersion, adopted.key, adopted.stored);
  } catch (error) {
    if (input.key.startsWith('uploads/')) await env.MEDIA.delete(adopted.key);
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
      return {
        ...editAssets(production, actor),
        assets: { ...production.assets, [asset]: null },
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
    .prepare(`INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, mentions, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, source_production_id, version)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 0, ?, ?, ?, ?, 1
    WHERE EXISTS (SELECT 1 FROM productions WHERE id = ? AND version = ? AND json_extract(data, '$.events[#-1].id') = ?)
    ON CONFLICT(source_production_id) DO UPDATE SET slug = excluded.slug, episode_number = excluded.episode_number, title = excluded.title, summary = excluded.summary, transcript = excluded.transcript, show_notes = excluded.show_notes, cover_url = excluded.cover_url, category = excluded.category, tags = excluded.tags, mentions = excluded.mentions, duration_seconds = excluded.duration_seconds, audio_url = excluded.audio_url, status = excluded.status, published_at = excluded.published_at, updated_at = excluded.updated_at, version = episodes.version + 1`)
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
      JSON.stringify(next.mentions ?? []),
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
    const results = await db.batch([
      categoryFence(db, next.category),
      updateStatement(db, next, input.version),
      snapshot,
    ]);
    if (results[1]?.meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重新确认发布');
    await syncEpisodeClaimFromRow(db, next.id);
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
  const results = await db.batch([updateStatement(db, next, version), snapshot]);
  if (results[0]?.meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重试');
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
      return json({
        productions: results.map((row) =>
          projectProduction(hydrateProduction(JSON.parse(row.data) as Production), actor),
        ),
      });
    }
    if (request.method === 'POST') {
      requireScope(actor, 'productions:write');
      const brief = await readJson(request, briefCreateSchema);
      await getCategory(env.DB, brief.category);
      const now = new Date().toISOString();
      const productionId = crypto.randomUUID();
      const maxAttempts = brief.episodeNumber === undefined ? 16 : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const episodeNumber =
          brief.episodeNumber ??
          (await nextEpisodeNumberInCategory(env.DB, brief.category, { productionId: productionId }));
        if (brief.episodeNumber !== undefined) {
          await assertEpisodeNumberAvailable(env.DB, brief.category, episodeNumber, {
            productionId: productionId,
          });
        }
        const production = appendEvent(
          {
            ...brief,
            mentions: brief.mentions ?? [],
            episodeNumber,
            id: productionId,
            version: 1,
            stage: 'draft',
            transcript: '',
            scriptVersion: 0,
            description: '',
            summary: '',
            assets: { cover: null, audio: null },
            approvals: { brief: null, script: null, final: null },
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
        try {
          await env.DB.batch([
            categoryFence(env.DB, brief.category),
            insertEpisodeNumberClaim(env.DB, brief.category, episodeNumber, productionId, 'production'),
            insert,
          ]);
          return respond(production, 201);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const unique = /UNIQUE constraint failed/.test(message);
          if (brief.episodeNumber !== undefined) {
            if (unique) throw new HttpError(409, '该栏目下已有相同期数');
            throw error;
          }
          if (!unique) throw error;
        }
      }
      /* v8 ignore next */
      throw new HttpError(503, '栏目期数暂时无法分配，请稍后重试');
    }
    throw new HttpError(405, '不支持这个请求方式');
  }
  const match = path.match(
    /^\/productions\/([^/]+)(?:\/(actions|prompts|assets\/(?:cover|audio(?:\/bind)?)|publications(?:\/(?:site|wechat|xiaoyuzhou))?))?$/,
  );
  if (!match) return null;
  const id = match[1];
  const operation = match[2];
  if (operation === 'assets/cover' && request.method === 'PUT')
    return respond(await uploadCover(request, env, id, actor));
  if (operation === 'assets/audio/bind' && request.method === 'POST')
    return respond(await bindAudio(request, env, id, actor));
  if (operation === 'assets/audio' && request.method === 'PUT')
    return respond(await uploadAudio(request, env, id, actor));
  if ((operation === 'assets/cover' || operation === 'assets/audio') && request.method === 'DELETE')
    return respond(
      await detachAsset(request, env, id, operation === 'assets/cover' ? 'cover' : 'audio', actor),
    );
  if (operation === 'actions' && request.method === 'POST') {
    const action = await readJson(request, productionActionSchema);
    const changes = action.changes;
    if (changes) {
      const patch = changes;
      const current = await getProduction(env.DB, id);
      const editedKeys = Object.keys(patch);
      const episodeNumber = await resolveProductionPatchEpisodeNumber(env.DB, current, patch);
      const merged = { ...patch, episodeNumber };
      const production = await updateProduction(
        env.DB,
        id,
        actor,
        action.action,
        (current) => applyAction(applyPatch(current, merged, actor, editedKeys), action, actor),
        { expectedVersion: action.version, feedback: action.feedback },
      );
      return respond(production);
    }
    const production = await updateProduction(
      env.DB,
      id,
      actor,
      action.action,
      (current) => {
        return applyAction(current, action, actor);
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
    const current = await getProduction(env.DB, id);
    const episodeNumber = await resolveProductionPatchEpisodeNumber(env.DB, current, fields);
    const production = await updateProduction(
      env.DB,
      id,
      actor,
      'edit',
      (production) => applyPatch(production, { ...fields, episodeNumber }, actor, Object.keys(fields)),
      { expectedVersion: version },
    );
    return respond(production);
  }
  if (request.method === 'DELETE') {
    requireScope(actor, 'productions:delete');
    const version = versionQuery(request);
    const production = await getProduction(env.DB, id);
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
    await deleteHolderEpisodeNumberClaims(env.DB, 'production', id).run();
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, '不支持这个请求方式');
}
