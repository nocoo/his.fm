import { speechCacheContent, speechSnapshotSchema } from '@his-fm/contracts';
import { type Actor, audioGenerationSchema, audioPreviewSchema } from '../src/shared/production';
import { cleanText } from '../src/shared/publication-format';
import { voiceSampleTranscript } from '../src/shared/voice-samples';
import { operationFence, operationReceipt } from './agent-runtime-operation';
import { runtimeConfiguration } from './ai-settings';
import { readStoredWav } from './audio';
import { type AudioSnapshot, getSettings } from './audio-store';
import { HttpError, json } from './http';
import { queueSpeech, speechResult } from './native-speech';
import { readJson } from './production-body';
import { editAssets } from './production-model';
import { appendEvent, getProduction, mediaUrl, nextVersion, updateStatement } from './production-store';

export async function triggerAudio(env: Env, jobId: string) {
  const row = await env.DB.prepare('SELECT snapshot FROM audio_jobs WHERE id = ?')
    .bind(jobId)
    .first<{ snapshot: string }>();
  if (!row) throw new HttpError(404, '音频任务不存在');
  const snapshot: AudioSnapshot = JSON.parse(row.snapshot);
  await queueSpeech(env, jobId, 'production', snapshot.speech, snapshot.productionId);
}

async function startAudio(request: Request, env: Env, id: string, actor: Actor) {
  const { version, provider, voice, speakingStyle, introId, outroId } = await readJson(
    request,
    audioGenerationSchema,
  );
  const production = await getProduction(env.DB, id);
  if (production.version !== version) throw new HttpError(409, '内容已更新，请刷新后重试');
  if (
    (actor.kind === 'agent' && production.stage !== 'production') ||
    !production.approvals.brief ||
    !production.approvals.script
  )
    throw new HttpError(409, '请先批准逐字稿再生成音频');
  if (production.audioJob && ['queued', 'running'].includes(production.audioJob.status)) {
    const fence = operationFence(env.DB);
    if (fence.length) {
      const results = await env.DB.batch([
        ...fence,
        env.DB.prepare('UPDATE productions SET version = version WHERE id = ? AND version = ?').bind(
          id,
          version,
        ),
        ...operationReceipt(env.DB, production, 200),
      ]);
      if (results[fence.length].meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重试');
    }
    if (production.audioJob.status === 'queued') await triggerAudio(env, production.audioJob.id);
    return json({ production });
  }
  const settings = await getSettings(env);
  const config = await runtimeConfiguration(env);
  const selected = provider ?? settings.provider;
  if (!config.providers[selected]) throw new HttpError(409, '请先在 AI 设置中配置所选语音服务');
  const intro = introId
    ? settings.bumpers.find((item) => item.id === introId && item.position === 'intro')
    : null;
  const outro = outroId
    ? settings.bumpers.find((item) => item.id === outroId && item.position === 'outro')
    : null;
  if ((introId && !intro) || (outroId && !outro)) throw new HttpError(409, '所选贴片不存在，请刷新后重试');
  const speech = speechSnapshotSchema.parse({
    provider: selected,
    model: config.settings[selected].model,
    voice: voice ?? config.settings[selected].voice,
    speakingStyle: speakingStyle ?? settings.speakingStyle,
    stability: config.settings.elevenlabs.stability,
    similarity: config.settings.elevenlabs.similarity,
    text: cleanText(production.transcript),
  });
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const snapshot: AudioSnapshot = {
    jobId,
    productionId: id,
    scriptVersion: production.scriptVersion,
    transcript: production.transcript,
    voice: speech.voice,
    speakingStyle: speech.speakingStyle,
    speech,
    introKey: intro?.key ?? null,
    outroKey: outro?.key ?? null,
  };
  const next = nextVersion(
    appendEvent(
      {
        ...editAssets(production, actor),
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
  const fence = operationFence(env.DB);
  const results = await env.DB.batch([
    ...fence,
    env.DB.prepare(
      "INSERT INTO audio_jobs (id, production_id, snapshot, status, created_at, updated_at) SELECT ?, ?, ?, 'queued', ?, ? WHERE EXISTS (SELECT 1 FROM productions WHERE id = ? AND version = ?)",
    ).bind(jobId, id, JSON.stringify(snapshot), now, now, id, version),
    updateStatement(env.DB, next, version),
    ...operationReceipt(env.DB, next),
  ]);
  if (results[fence.length + 1].meta.changes !== 1) throw new HttpError(409, '内容已更新，请刷新后重试');
  await triggerAudio(env, jobId);
  return json({ production: await getProduction(env.DB, id) }, 202);
}

async function previewAudio(request: Request, env: Env) {
  if (request.method !== 'POST') throw new HttpError(405, '不支持这个请求方式');
  const input = await readJson(request, audioPreviewSchema);
  const config = await runtimeConfiguration(env);
  if (!config.providers[input.provider]) throw new HttpError(409, '请先配置所选语音服务的 Key');
  const snapshot = speechSnapshotSchema.parse({
    ...input,
    model: config.settings[input.provider].model,
    stability: config.settings.elevenlabs.stability,
    similarity: config.settings.elevenlabs.similarity,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(speechCacheContent(snapshot)),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const key = `audio/previews/${hash}.wav`;
  if (await env.MEDIA.head(key))
    return json({
      preview: {
        ...input,
        url: mediaUrl(env, key),
        durationSeconds: (await readStoredWav(env.MEDIA, key)).durationSeconds,
        cached: true,
      },
    });
  await queueSpeech(env, hash, 'preview', snapshot, null);
  return json({ jobId: hash }, 202);
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
  if (actor.kind !== 'human') throw new HttpError(403, '只有编辑可以管理语音设置');
  if (path === '/production-settings/preview') return previewAudio(request, env);
  if (path === '/production-settings/previews' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      "SELECT result FROM speech_jobs WHERE kind = 'preview' AND status = 'complete' AND json_extract(snapshot, '$.text') = ? ORDER BY created_at DESC LIMIT 30",
    )
      .bind(voiceSampleTranscript)
      .all<{ result: string }>();
    return json({ previews: rows.results.map((row) => JSON.parse(row.result)) });
  }
  const preview = /^\/production-settings\/preview\/([a-f0-9]{64})$/.exec(path);
  if (preview && request.method === 'GET') return speechResult(env, preview[1]);
  if (path === '/production-settings' && request.method === 'GET')
    return json({ settings: await getSettings(env) });
  throw new HttpError(404, '接口不存在');
}
