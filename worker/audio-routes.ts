import { z } from 'zod';
import { type Actor, productionSettingsSchema } from '../src/shared/production';
import { AudioError, parseWav } from './audio';
import { type AudioSnapshot, getSettings, saveBumper } from './audio-store';
import { HttpError, json } from './http';
import { readBytes, readJson } from './production-body';
import { appendEvent, getProduction, mediaUrl, nextVersion, updateStatement } from './production-store';

async function triggerAudio(env: Env, jobId: string) {
  try {
    await env.AUDIO_WORKFLOW.create({ id: jobId, params: { jobId } });
  } catch {
    try {
      const instance = await env.AUDIO_WORKFLOW.get(jobId);
      const status = await instance.status();
      if (status.status === 'errored' || status.status === 'terminated') await instance.restart();
    } catch {
      throw new HttpError(503, '音频任务已保存，但派发失败，请重试派发');
    }
  }
}

async function startAudio(request: Request, env: Env, id: string, actor: Actor) {
  const { version } = await readJson(request, z.strictObject({ version: z.number().int().min(1) }));
  const production = await getProduction(env.DB, id);
  if (production.version !== version) throw new HttpError(409, '内容已更新，请刷新后重试');
  if (production.stage !== 'production' || !production.approvals.script)
    throw new HttpError(409, '请先批准逐字稿再生成音频');
  if (production.audioJob && ['queued', 'running'].includes(production.audioJob.status)) {
    await triggerAudio(env, production.audioJob.id);
    return json({ production });
  }
  const settings = await getSettings(env);
  if (!settings.ttsConfigured) throw new HttpError(409, '请先配置 Gemini API 密钥');
  if (!settings.intro || !settings.outro) throw new HttpError(409, '请先上传片头与片尾音频');
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const snapshot: AudioSnapshot = {
    jobId,
    productionId: id,
    scriptVersion: production.scriptVersion,
    transcript: production.transcript,
    voice: settings.voice,
    speakingStyle: settings.speakingStyle,
    introKey: settings.intro.key,
    outroKey: settings.outro.key,
  };
  const next = nextVersion(
    appendEvent(
      {
        ...production,
        audioJob: {
          id: jobId,
          status: 'queued',
          scriptVersion: production.scriptVersion,
          createdAt: now,
          error: null,
        },
        assets: { ...production.assets, audio: null },
      },
      actor,
      'audio_queued',
    ),
    version,
  );
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO audio_jobs (id, production_id, snapshot, status, created_at, updated_at) SELECT ?, ?, ?, 'queued', ?, ? WHERE EXISTS (SELECT 1 FROM productions WHERE id = ? AND version = ?)",
    ).bind(jobId, id, JSON.stringify(snapshot), now, now, id, version),
    updateStatement(env.DB, next, version),
  ]);
  if (results[1].meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重试');
  await triggerAudio(env, jobId);
  return json({ production: await getProduction(env.DB, id) }, 202);
}

export async function routeAudio(
  request: Request,
  env: Env,
  path: string,
  actor: Actor,
): Promise<Response | null> {
  const match = /^\/productions\/([^/]+)\/audio$/.exec(path);
  if (match) {
    if (request.method !== 'POST') throw new HttpError(405, '不支持这个请求方式');
    return startAudio(request, env, match[1], actor);
  }
  if (!path.startsWith('/production-settings')) return null;
  if (actor.kind !== 'human') throw new HttpError(403, '只有编辑可以管理工作室配置');
  if (path === '/production-settings') {
    if (request.method === 'GET') return json({ settings: await getSettings(env) });
    if (request.method !== 'PUT') throw new HttpError(405, '不支持这个请求方式');
    const settings = await readJson(request, productionSettingsSchema);
    await getSettings(env);
    await env.DB.prepare(
      "UPDATE production_settings SET data = json_set(data, '$.voice', ?, '$.speakingStyle', ?) WHERE id = 1",
    )
      .bind(settings.voice, settings.speakingStyle)
      .run();
    return json({ settings: await getSettings(env) });
  }
  const bumper = /^\/production-settings\/(intro|outro)$/.exec(path);
  if (!bumper) throw new HttpError(404, '接口不存在');
  if (request.method !== 'PUT') throw new HttpError(405, '不支持这个请求方式');
  const bytes = await readBytes(request, 3 * 1024 * 1024);
  let durationSeconds: number;
  try {
    durationSeconds = parseWav(bytes).durationSeconds;
  } catch (error) {
    if (error instanceof AudioError) throw new HttpError(400, error.message);
    throw error;
  }
  if (durationSeconds > 30) throw new HttpError(400, '片头或片尾不能超过 30 秒');
  const position = bumper[1] as 'intro' | 'outro';
  const key = `bumpers/${position}-${crypto.randomUUID()}.wav`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: 'audio/wav', cacheControl: 'public, max-age=31536000, immutable' },
  });
  return json({
    settings: await saveBumper(env, position, {
      key,
      url: mediaUrl(env, key),
      durationSeconds,
      size: bytes.byteLength,
    }),
  });
}
