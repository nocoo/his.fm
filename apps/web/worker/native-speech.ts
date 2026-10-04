import { type SpeechSnapshot, speechSnapshotSchema } from '@his-fm/contracts';
import { requireRuntimeOrigin } from './agent-runtime';
import { digest, requireCommand, station } from './agent-runtime-store';
import { authenticateAgentIdentity } from './agent-tokens';
import { AudioError, composeWav, readStoredWav, storeNativeWav } from './audio';
import { checkActiveAudio, getAudioSnapshot, setAudioState } from './audio-store';
import { HttpError, json } from './http';
import { getProduction, mediaUrl } from './production-store';

export async function queueSpeech(
  env: Env,
  id: string,
  kind: 'preview' | 'production',
  input: SpeechSnapshot,
  productionId: string | null,
) {
  const existing = await env.DB.prepare(
    'SELECT speech_jobs.status, agent_commands.status AS commandStatus FROM speech_jobs JOIN agent_commands ON agent_commands.id=speech_jobs.command_id WHERE speech_jobs.id = ?',
  )
    .bind(id)
    .first<{ status: string; commandStatus: string }>();
  if (
    existing &&
    existing.status !== 'complete' &&
    ['complete', 'failed', 'cancelled'].includes(existing.commandStatus)
  ) {
    await env.DB.prepare("UPDATE speech_jobs SET status='failed' WHERE id=? AND status!='complete'")
      .bind(id)
      .run();
    existing.status = 'failed';
  }
  if (existing && existing.status !== 'failed') return;
  const commandId = `speech:${id}:${crypto.randomUUID()}`;
  const production = productionId ? await getProduction(env.DB, productionId) : null;
  const commandInput = {
    id: commandId,
    text: `执行已确认的${kind === 'preview' ? '短试听' : '正文音频'}任务。使用专职语音 conversation，调用 generate_speech，核验任务回执后完成。speechJobId=${id}`,
    context: production
      ? {
          tabId: commandId,
          pageEpoch: 0,
          seq: 0,
          route: `/admin/productions/${production.id}`,
          productionId: production.id,
          step: 'assets' as const,
          sourceId: null,
          version: production.version,
          field: null,
          draft: null,
          selection: null,
          activity: 'viewing' as const,
        }
      : null,
  };
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO agent_commands (id, hash, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    ).bind(commandId, await digest(commandInput), JSON.stringify({ ...commandInput, createdAt: now }), now),
    env.DB.prepare(
      "INSERT INTO speech_jobs (id, kind, snapshot, command_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET command_id=excluded.command_id, status='queued', generation=NULL WHERE speech_jobs.status='failed'",
    ).bind(id, kind, JSON.stringify(speechSnapshotSchema.parse(input)), commandId, now),
    env.DB.prepare(
      'DELETE FROM agent_commands WHERE id=? AND NOT EXISTS (SELECT 1 FROM speech_jobs WHERE command_id=?)',
    ).bind(commandId, commandId),
  ]);
}

export async function speechResult(env: Env, id: string) {
  const job = await env.DB.prepare('SELECT status, result FROM speech_jobs WHERE id = ? AND kind = ?')
    .bind(id, 'preview')
    .first<{ status: string; result: string | null }>();
  if (!job) throw new HttpError(404, '试听任务不存在');
  if (job.status === 'failed') throw new HttpError(502, '本机试听生成失败，请在主控查看任务状态');
  return json(
    job.result ? { preview: JSON.parse(job.result) } : { jobId: id, status: job.status },
    job.result ? 200 : 202,
  );
}

export async function routeNativeSpeech(request: Request, env: Env) {
  requireRuntimeOrigin(request, env, false);
  const auth = await authenticateAgentIdentity(request, env);
  const current = await station(env.DB);
  const generation = request.headers.get('X-Hisfm-Generation');
  if (
    !current ||
    !generation ||
    current.tokenId !== auth.tokenId ||
    current.stationId !== request.headers.get('X-Hisfm-Station') ||
    current.generation !== generation ||
    current.leaseUntil <= Date.now()
  )
    throw new HttpError(403, '语音任务需要有效主控租约');
  const match = /^\/api\/agent\/runtime\/speech\/([a-zA-Z0-9-]+)$/.exec(new URL(request.url).pathname);
  if (!match) throw new HttpError(404, '语音任务不存在');
  const id = match[1] as string;
  const job = await env.DB.prepare(
    'SELECT kind, snapshot, command_id AS commandId, status, result FROM speech_jobs WHERE id = ?',
  )
    .bind(id)
    .first<{
      kind: 'preview' | 'production';
      snapshot: string;
      commandId: string;
      status: string;
      result: string | null;
    }>();
  if (!job || job.commandId !== request.headers.get('X-Hisfm-Command'))
    throw new HttpError(403, '语音任务超出指令范围');
  if (job.status === 'complete') return json({ complete: true, result: JSON.parse(job.result ?? '{}') });
  const command = await requireCommand(env.DB, job.commandId, true);
  if (command.status === 'cancelling') throw new HttpError(409, '指令正在取消');
  const input = speechSnapshotSchema.parse(JSON.parse(job.snapshot));
  const fence = () =>
    env.DB.prepare(`INSERT OR REPLACE INTO agent_write_fence (id, valid) VALUES (1, CASE WHEN EXISTS (
    SELECT 1 FROM agent_station JOIN agent_tokens ON agent_tokens.id=agent_station.token_id JOIN agent_commands ON agent_commands.id=?
    WHERE agent_station.id=1 AND token_id=? AND station_id=? AND generation=? AND lease_until>? AND revoked_at IS NULL AND expires_at>?
    AND agent_commands.status NOT IN ('complete','failed','cancelled','cancelling')
  ) THEN 1 ELSE 0 END)`).bind(
      job.commandId,
      auth.tokenId,
      current.stationId,
      generation,
      Date.now(),
      new Date().toISOString(),
    );
  const audio = job.kind === 'production' ? await getAudioSnapshot(env.DB, id) : null;
  if (audio) await checkActiveAudio(env, audio);
  if (request.method === 'GET') return json({ input, complete: false });
  if (request.method === 'DELETE') {
    const failed = env.DB.prepare(
      "UPDATE speech_jobs SET status = 'failed' WHERE id = ? AND status != 'complete' AND changes()=1",
    ).bind(id);
    if (audio)
      await setAudioState(env, audio, 'failed', '本机语音生成未完成，请检查服务配置后重试', undefined, {
        before: [fence()],
        after: [failed],
      });
    else await env.DB.batch([fence(), failed]);
    return json({ failed: true });
  }
  if (request.method === 'POST') {
    const running = env.DB.prepare(
      "UPDATE speech_jobs SET status = 'running', generation = ? WHERE id = ? AND status != 'complete' AND changes()=1",
    ).bind(generation, id);
    if (audio)
      await setAudioState(env, audio, 'running', null, undefined, { before: [fence()], after: [running] });
    else await env.DB.batch([fence(), running]);
    return json({ accepted: true });
  }
  if (request.method !== 'PUT') throw new HttpError(405, '不支持这个请求方式');
  const key = audio
    ? `audio/${audio.productionId}/${audio.scriptVersion}/${id}/narration.wav`
    : `audio/previews/${id}.wav`;
  const upload = `${key}.upload-${crypto.randomUUID()}`;
  try {
    await storeNativeWav(request, env.MEDIA, upload, job.kind === 'preview' ? 120 : 1800);
  } catch (error) {
    if (error instanceof AudioError) throw new HttpError(400, error.message);
    throw error;
  }
  try {
    const active = await station(env.DB);
    if (active?.generation !== generation || active.leaseUntil <= Date.now())
      throw new HttpError(409, '主控租约已更新');
    await requireCommand(env.DB, job.commandId, true);
    if (audio) await checkActiveAudio(env, audio);
    const existing = await env.MEDIA.head(key);
    if (!existing) await composeWav(env.MEDIA, [upload], key);
  } finally {
    await env.MEDIA.delete(upload);
  }
  const stored = await readStoredWav(env.MEDIA, key);
  let final = { key, durationSeconds: stored.durationSeconds, bytes: stored.size };
  if (audio && (audio.introKey || audio.outroKey)) {
    const finalKey = key.replace('narration.wav', 'final.wav');
    if (await env.MEDIA.head(finalKey)) {
      const stored = await readStoredWav(env.MEDIA, finalKey);
      final = { key: finalKey, durationSeconds: stored.durationSeconds, bytes: stored.size };
    } else
      final = await composeWav(
        env.MEDIA,
        [audio.introKey, key, audio.outroKey].filter((part): part is string => Boolean(part)),
        finalKey,
      );
  }
  const result = {
    ...input,
    url: mediaUrl(env, final.key),
    durationSeconds: final.durationSeconds,
    cached: false,
  };
  const complete = env.DB.prepare(
    "UPDATE speech_jobs SET status = 'complete', result = ? WHERE id = ? AND status != 'complete' AND changes()=1",
  ).bind(JSON.stringify(result), id);
  if (audio)
    await setAudioState(
      env,
      audio,
      'complete',
      null,
      {
        key: final.key,
        url: result.url,
        durationSeconds: final.durationSeconds,
        size: final.bytes,
        mimeType: 'audio/wav',
        voice: input.voice,
        includesBumpers: Boolean(audio.introKey || audio.outroKey),
        scriptVersion: audio.scriptVersion,
        createdAt: new Date().toISOString(),
      },
      { before: [fence()], after: [complete] },
    );
  else await env.DB.batch([fence(), complete]);
  return json({ complete: true, result });
}
