import type {
  AudioJob,
  Bumper,
  Production,
  ProductionAsset,
  ProductionSettings,
} from '../src/shared/production';
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
};
const defaults = {
  voice: 'Kore',
  speakingStyle:
    'Speak Mandarin Chinese as a thoughtful solo podcast host. Natural conversational delivery, calm warmth, clear articulation, gentle pauses. Read only the supplied script, without adding words or music.',
  intro: null,
  outro: null,
};

export async function getSettings(env: Env): Promise<ProductionSettings> {
  await env.DB.prepare('INSERT INTO production_settings (id, data) VALUES (1, ?) ON CONFLICT DO NOTHING')
    .bind(JSON.stringify(defaults))
    .run();
  const row = await env.DB.prepare('SELECT data FROM production_settings WHERE id = 1').first<{
    data: string;
  }>();
  return { ...JSON.parse(row?.data ?? JSON.stringify(defaults)), ttsConfigured: Boolean(env.GEMINI_API_KEY) };
}

export async function saveBumper(env: Env, position: 'intro' | 'outro', bumper: Bumper) {
  await getSettings(env);
  await env.DB.prepare('UPDATE production_settings SET data = json_set(data, ?, json(?)) WHERE id = 1')
    .bind(`$.${position}`, JSON.stringify(bumper))
    .run();
  return getSettings(env);
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
    if (current.audioJob?.status === status && current.audioJob.error === error && job.status === status)
      return;
    const next = nextVersion(
      appendEvent(
        {
          ...current,
          audioJob: { ...current.audioJob, status, error },
          assets: asset ? { ...current.assets, audio: asset } : current.assets,
        },
        { kind: 'agent', name: 'Cloudflare Audio' },
        `audio_${status}`,
      ),
      current.version,
    );
    const results = await env.DB.batch([
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
    ]);
    if (results[0]?.meta.changes === 1) return;
  }
  throw new HttpError(409, '内容正在更新，请稍后重试');
}
