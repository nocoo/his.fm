import type { AudioJob, Production, ProductionAsset, ProductionSettings } from '../src/shared/production';
import { runtimeConfiguration } from './ai-settings';
import { HttpError } from './http';
import { appendEvent, getProduction, nextVersion, updateStatement } from './production-store';

export type AudioSnapshot = {
  jobId: string;
  productionId: string;
  scriptVersion: number;
  transcript: string;
  voice: string;
  speakingStyle: string;
  introKey: string | null;
  outroKey: string | null;
  speech: import('@his-fm/contracts').SpeechSnapshot;
  principal: import('@his-fm/contracts').Principal;
};
export async function getSettings(env: Env): Promise<ProductionSettings> {
  const config = await runtimeConfiguration(env);
  const rows = await env.DB.prepare(
    'SELECT id, name, position, version, data FROM bumpers ORDER BY name, id',
  ).all<{ id: string; name: string; position: 'intro' | 'outro'; version: number; data: string }>();
  const provider = config.settings.defaultProvider;
  return {
    version: config.version,
    provider,
    voice: config.settings[provider].voice,
    speakingStyle: config.settings.speakingStyle,
    ttsConfigured: config.providers[provider],
    providers: { gemini: config.providers.gemini, elevenlabs: config.providers.elevenlabs },
    voices: { gemini: config.settings.gemini.voice, elevenlabs: config.settings.elevenlabs.voice },
    bumpers: rows.results.map(({ data, ...record }) => ({ ...JSON.parse(data), ...record })),
  };
}

export async function getAudioSnapshot(db: D1Database, jobId: string): Promise<AudioSnapshot> {
  const row = await db
    .prepare('SELECT snapshot FROM audio_jobs WHERE id = ?')
    .bind(jobId)
    .first<{ snapshot: string }>();
  if (!row) throw new HttpError(404, '音频任务不存在');
  return JSON.parse(row.snapshot);
}

export function requireActiveAudio(
  production: Production,
  snapshot: AudioSnapshot,
): asserts production is Production & { audioJob: AudioJob } {
  if (
    production.stage !== 'production' ||
    !production.approvals.script ||
    production.scriptVersion !== snapshot.scriptVersion ||
    production.audioJob?.id !== snapshot.jobId
  ) {
    throw new HttpError(409, '逐字稿或制作状态已更新，旧音频任务停止');
  }
}

export async function checkActiveAudio(env: Env, snapshot: AudioSnapshot) {
  requireActiveAudio(await getProduction(env.DB, snapshot.productionId), snapshot);
}

export async function setAudioState(
  env: Env,
  snapshot: AudioSnapshot,
  status: 'running' | 'failed' | 'complete',
  error: string | null = null,
  asset?: ProductionAsset,
  transaction?: { before: D1PreparedStatement[]; after: D1PreparedStatement[] },
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const job = await env.DB.prepare('SELECT status FROM audio_jobs WHERE id = ?')
      .bind(snapshot.jobId)
      .first<{ status: string }>();
    if (!job || job.status === 'complete') return;
    let current: Production & { audioJob: AudioJob };
    try {
      const candidate = await getProduction(env.DB, snapshot.productionId);
      requireActiveAudio(candidate, snapshot);
      current = candidate;
    } catch (cause) {
      if (!(cause instanceof HttpError) || ![404, 409].includes(cause.status)) throw cause;
      if (status === 'complete') throw cause;
      await env.DB.prepare(
        "UPDATE audio_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status != 'complete'",
      )
        .bind(error ?? cause.message, new Date().toISOString(), snapshot.jobId)
        .run();
      return;
    }
    if (status === 'complete' && !asset) throw new HttpError(400, '完成音频任务需要成品素材');
    if (
      !transaction &&
      current.audioJob?.status === status &&
      current.audioJob.error === error &&
      job.status === status
    )
      return;
    const next = nextVersion(
      appendEvent(
        {
          ...current,
          audioJob: { ...current.audioJob, status, error },
          assets: asset ? { ...current.assets, audio: asset } : current.assets,
        },
        { kind: 'agent', name: 'Native Speech' },
        `audio_${status}`,
      ),
      current.version,
    );
    const results = await env.DB.batch([
      ...(transaction?.before ?? []),
      updateStatement(env.DB, next, current.version),
      env.DB.prepare(`UPDATE audio_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?
        AND EXISTS (SELECT 1 FROM productions WHERE id = ? AND version = ? AND json_extract(data, '$.events[#-1].id') = ?)`).bind(
        status,
        error,
        next.updatedAt,
        snapshot.jobId,
        next.id,
        next.version,
        next.events.at(-1)?.id,
      ),
      ...(transaction?.after ?? []),
    ]);
    if (results[transaction?.before.length ?? 0]?.meta.changes === 1) return;
  }
  throw new HttpError(409, '内容正在更新，请稍后重试');
}
