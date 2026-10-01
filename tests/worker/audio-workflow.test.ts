import type { WorkflowStep } from 'cloudflare:workers';
import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Production } from '../../src/shared/production';
import * as audio from '../../worker/audio';
import { routeAudio } from '../../worker/audio-routes';
import { getAudioSnapshot, getSettings, requireActiveAudio, setAudioState } from '../../worker/audio-store';
import { AudioWorkflow } from '../../worker/audio-workflow';
import { HttpError } from '../../worker/http';
import worker from '../../worker/index';
import { getProduction, saveProduction } from '../../worker/production-store';
import { agent, human, readyFixture } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

let mf: Miniflare;
let env: Env;
const create = vi.fn();
const get = vi.fn();
const origin = 'https://hisfm.dev.hexly.ai';
const bytes = new Uint8Array(48_044);
bytes.set(audio.wavHeader(48_000));

function request(path: string, method = 'GET', data?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function call(path: string, method = 'GET', data?: unknown, actor = human) {
  try {
    return await routeAudio(request(path, method, data), env, path, actor);
  } catch (error) {
    if (error instanceof HttpError) return new Response(error.message, { status: error.status });
    throw error;
  }
}
async function upload(position: 'intro' | 'outro', wav = bytes) {
  return routeAudio(
    new Request(`${origin}/production-settings/${position}`, { method: 'PUT', body: wav }),
    env,
    `/production-settings/${position}`,
    human,
  );
}
async function insert() {
  const production = readyFixture({
    stage: 'production',
    assets: { cover: null, audio: null },
    audioJob: null,
  });
  await env.DB.prepare('INSERT INTO productions VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      production.id,
      production.version,
      production.stage,
      JSON.stringify(production),
      production.createdAt,
      production.updatedAt,
    )
    .run();
  return production;
}
async function start() {
  await upload('intro');
  await upload('outro');
  const p = await insert();
  const response = await call(`/productions/${p.id}/audio`, 'POST', { version: p.version });
  if (!response) throw new Error('Missing audio response');
  expect(response.status).toBe(202);
  return ((await response.json()) as { production: Production }).production;
}
function steps() {
  const calls: string[] = [];
  const run = vi.fn(async (name: string, options: unknown, callback?: () => Promise<unknown>) => {
    calls.push(name);
    return callback ? callback() : (options as () => Promise<unknown>)();
  });
  const step: WorkflowStep = {
    do: run as WorkflowStep['do'],
    sleep: vi.fn(),
    sleepUntil: vi.fn(),
    waitForEvent: vi.fn(),
  };
  return { step, calls };
}
async function run(p: Production, runner = steps()) {
  const workflow = new AudioWorkflow({} as ExecutionContext, env);
  return workflow.run(
    {
      payload: { jobId: p.audioJob?.id ?? '' },
      instanceId: p.audioJob?.id ?? '',
      workflowName: 'audio',
      timestamp: new Date(),
    },
    runner.step,
  );
}

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'hisfm-audio-route-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("test")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'audio-test' },
            MEDIA: { type: 'r2', name: 'audio-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = {
    ...(await mf.getBindings<Env>()),
    GEMINI_API_KEY: 'test-only-key',
    AUDIO_WORKFLOW: { create, get, createBatch: vi.fn(), deleteBatch: vi.fn() },
  };
  const directory = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(new URL(name, directory), 'utf8')
        .split(';')
        .filter((part) => part.trim())
        .map((part) => env.DB.prepare(part)),
    );
  }
}, 30000);
beforeEach(async () => {
  vi.restoreAllMocks();
  create.mockReset().mockResolvedValue({ id: 'created' });
  get.mockReset();
  await env.DB.batch(
    [
      'DELETE FROM audio_jobs',
      'DELETE FROM productions',
      'DELETE FROM production_settings',
      'DELETE FROM agent_tokens',
    ].map((sql) => env.DB.prepare(sql)),
  );
});
afterAll(() => mf.dispose());

describe('audio settings and dispatch', () => {
  it('keeps settings human-only and validates complete WAV bumpers', async () => {
    expect((await call('/production-settings', 'GET', undefined, agent))?.status).toBe(403);
    expect((await call('/production-settings', 'POST'))?.status).toBe(405);
    expect((await call('/production-settings/missing'))?.status).toBe(404);
    expect((await call('/production-settings/intro', 'GET'))?.status).toBe(405);
    expect(await call('/unrelated')).toBeNull();
    expect(await getSettings(env)).toMatchObject({
      voice: 'Kore',
      intro: null,
      outro: null,
      ttsConfigured: true,
    });
    expect(
      (await call('/production-settings', 'PUT', { voice: 'Puck', speakingStyle: 'Natural Chinese podcast' }))
        ?.status,
    ).toBe(200);
    expect(await getSettings(env)).toMatchObject({ voice: 'Puck' });
    await expect(upload('intro', new Uint8Array(1))).rejects.toMatchObject({ status: 400 });
    const long = new Uint8Array(31 * 48000 + 44);
    long.set(audio.wavHeader(long.length - 44));
    await expect(upload('intro', long)).rejects.toMatchObject({ status: 400 });
    await upload('intro');
    await upload('outro');
    expect(await getSettings(env)).toMatchObject({ intro: { durationSeconds: 1 }, outro: { size: 48044 } });
    expect(await getSettings({ ...env, GEMINI_API_KEY: '' })).toMatchObject({ ttsConfigured: false });
  });
  it('requires script approval and a key, and bumpers only when requested', async () => {
    const p = await insert();
    const path = `/productions/${p.id}/audio`;
    expect((await call(path, 'GET'))?.status).toBe(405);
    expect((await call(path, 'POST', { version: 99 }))?.status).toBe(409);
    expect((await call(path, 'POST', { version: 1, includeBumpers: true }))?.status).toBe(409);
    await expect(
      routeAudio(request(path, 'POST', { version: 1 }), { ...env, GEMINI_API_KEY: '' }, path, human),
    ).rejects.toMatchObject({ status: 409 });
    await saveProduction(
      env.DB,
      { ...p, stage: 'script_review', approvals: { ...p.approvals, script: null } },
      1,
    );
    expect((await call(path, 'POST', { version: 2 }))?.status).toBe(409);
    await expect(getAudioSnapshot(env.DB, 'missing')).rejects.toMatchObject({ status: 404 });
  });
  it('creates an immutable snapshot and reuses a queued job after a dispatch interruption', async () => {
    const p = await start();
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    expect(snapshot).toMatchObject({
      productionId: p.id,
      transcript: p.transcript,
      voice: 'Kore',
      scriptVersion: 1,
    });
    create.mockRejectedValue(new Error('already exists'));
    const restart = vi.fn();
    get.mockResolvedValue({ status: async () => ({ status: 'queued' }), restart });
    expect((await call(`/productions/${p.id}/audio`, 'POST', { version: p.version }))?.status).toBe(200);
    expect(restart).not.toHaveBeenCalled();
    get.mockResolvedValue({ status: async () => ({ status: 'errored' }), restart });
    expect((await call(`/productions/${p.id}/audio`, 'POST', { version: p.version }))?.status).toBe(200);
    expect(restart).toHaveBeenCalledOnce();
    get.mockRejectedValue(new Error('unavailable'));
    expect((await call(`/productions/${p.id}/audio`, 'POST', { version: p.version }))?.status).toBe(503);
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM audio_jobs').first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});

describe('durable audio orchestration', () => {
  it('generates narration without bumpers and snapshots per-job voice overrides', async () => {
    const production = await insert();
    const response = await call(`/productions/${production.id}/audio`, 'POST', {
      version: 1,
      voice: 'Sulafat',
      speakingStyle: '温暖的中文讲述',
    });
    expect(response?.status).toBe(202);
    if (!response) throw new Error('Missing audio response');
    const p = ((await response.json()) as { production: Production }).production;
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    expect(snapshot).toMatchObject({
      voice: 'Sulafat',
      speakingStyle: '温暖的中文讲述',
      introKey: null,
      outroKey: null,
    });
    expect((await getSettings(env)).voice).toBe('Kore');
    const synthesize = vi
      .spyOn(audio, 'synthesizeSpeech')
      .mockResolvedValue({ bytes, info: audio.parseWav(bytes), interactionId: 'test' });
    const compose = vi.spyOn(audio, 'composeWav').mockImplementation(async (bucket, parts, key) => {
      expect(parts).toHaveLength(1);
      expect(parts[0]).toContain('part-001.wav');
      await bucket.put(key, bytes);
      return { key, bytes: bytes.length, durationSeconds: 1 };
    });
    await run(p);
    expect(synthesize).toHaveBeenCalledWith('test-only-key', p.transcript, 'Sulafat', '温暖的中文讲述');
    expect(compose).toHaveBeenCalledOnce();
    expect((await getProduction(env.DB, p.id)).assets.audio).toMatchObject({
      voice: 'Sulafat',
      includesBumpers: false,
    });
  });
  it('adds configured bumpers only when requested and reuses stored composition on replay', async () => {
    await upload('intro');
    await upload('outro');
    const original = await insert();
    const response = await call(`/productions/${original.id}/audio`, 'POST', {
      version: 1,
      includeBumpers: true,
    });
    if (!response) throw new Error('Missing audio response');
    const p = ((await response.json()) as { production: Production }).production;
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    const prefix = `audio/${p.id}/${p.scriptVersion}/${snapshot.jobId}`;
    await env.MEDIA.put(`${prefix}/part-001.wav`, bytes);
    await env.MEDIA.put(`${prefix}/narration.wav`, bytes);
    await env.MEDIA.put(`${prefix}/final.wav`, bytes);
    const synthesize = vi.spyOn(audio, 'synthesizeSpeech');
    const compose = vi.spyOn(audio, 'composeWav');
    await run(p);
    expect(synthesize).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
    expect((await getProduction(env.DB, p.id)).assets.audio).toMatchObject({
      includesBumpers: true,
      durationSeconds: 1,
    });
  });
  it('composes narration then real bumper keys in order', async () => {
    await upload('intro');
    await upload('outro');
    const original = await insert();
    const response = await call(`/productions/${original.id}/audio`, 'POST', {
      version: 1,
      includeBumpers: true,
    });
    if (!response) throw new Error('Missing audio response');
    const p = ((await response.json()) as { production: Production }).production;
    vi.spyOn(audio, 'synthesizeSpeech').mockResolvedValue({
      bytes,
      info: audio.parseWav(bytes),
      interactionId: 'test',
    });
    const compose = vi.spyOn(audio, 'composeWav').mockImplementation(async (bucket, _keys, key) => {
      await bucket.put(key, bytes);
      return { key, bytes: bytes.length, durationSeconds: 1 };
    });
    await run(p);
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    expect(compose).toHaveBeenCalledTimes(2);
    expect(compose.mock.calls[1][1]).toEqual([
      snapshot.introKey,
      expect.stringContaining('/narration.wav'),
      snapshot.outroKey,
    ]);
  });
  it('generates once per checkpoint and merges the final result without losing parallel assets', async () => {
    const p = await start();
    vi.spyOn(audio, 'synthesizeSpeech').mockResolvedValue({
      bytes,
      info: audio.parseWav(bytes),
      interactionId: 'test',
    });
    vi.spyOn(audio, 'composeWav').mockImplementation(async (bucket, _keys, key) => {
      await bucket.put(key, bytes);
      return { key, bytes: bytes.length, durationSeconds: 3 };
    });
    const runner = steps();
    const result = await run(p, runner);
    expect(result.durationSeconds).toBe(3);
    expect(runner.calls).toContain('narrate-1');
    const saved = await getProduction(env.DB, p.id);
    expect(saved.audioJob?.status).toBe('complete');
    expect(saved.assets.audio?.url).toContain('/media/audio/');
    expect(audio.synthesizeSpeech).toHaveBeenCalledOnce();
    await run(saved);
    expect(audio.synthesizeSpeech).toHaveBeenCalledOnce();
    expect(audio.composeWav).toHaveBeenCalledOnce();
    expect(await getProduction(env.DB, p.id)).toEqual(saved);
    const reviewing = await saveProduction(env.DB, { ...saved, stage: 'final_review' }, saved.version);
    await run(reviewing);
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    await setAudioState(env, snapshot, 'failed', 'late failure');
    await setAudioState(env, snapshot, 'running');
    expect(await getProduction(env.DB, p.id)).toEqual(reviewing);
    expect(
      await env.DB.prepare('SELECT status FROM audio_jobs WHERE id = ?').bind(snapshot.jobId).first(),
    ).toEqual({ status: 'complete' });
  });
  it('rolls back both audio records when completion storage fails', async () => {
    const p = await start();
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    const asset = {
      key: 'audio/final.wav',
      url: '/media/audio/final.wav',
      mimeType: 'audio/wav',
      size: bytes.length,
      scriptVersion: snapshot.scriptVersion,
      createdAt: new Date().toISOString(),
      durationSeconds: 1,
    };
    await env.DB.prepare(
      "CREATE TRIGGER reject_audio_complete BEFORE UPDATE ON audio_jobs WHEN NEW.status = 'complete' BEGIN SELECT RAISE(ABORT, 'completion interrupted'); END",
    ).run();
    try {
      await expect(setAudioState(env, snapshot, 'complete', null, asset)).rejects.toThrow(
        'completion interrupted',
      );
      expect(await getProduction(env.DB, p.id)).toEqual(p);
      expect(
        await env.DB.prepare('SELECT status FROM audio_jobs WHERE id = ?').bind(snapshot.jobId).first(),
      ).toEqual({ status: 'queued' });
    } finally {
      await env.DB.prepare('DROP TRIGGER reject_audio_complete').run();
    }
    await setAudioState(env, snapshot, 'complete', null, asset);
    const complete = await getProduction(env.DB, p.id);
    await setAudioState(env, snapshot, 'complete', null, asset);
    expect(await getProduction(env.DB, p.id)).toEqual(complete);
  });
  it('records provider errors without secrets and rejects stale approved revisions', async () => {
    const p = await start();
    vi.spyOn(audio, 'synthesizeSpeech').mockRejectedValue(
      new audio.AudioError('语音服务请求失败（HTTP 400）'),
    );
    await expect(run(p)).rejects.toThrow('HTTP 400');
    expect((await getProduction(env.DB, p.id)).audioJob).toMatchObject({
      status: 'failed',
      error: '语音服务请求失败（HTTP 400）',
    });
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    expect(() => requireActiveAudio({ ...p, scriptVersion: 2 }, snapshot)).toThrow('旧音频');
    const current = await getProduction(env.DB, p.id);
    await saveProduction(env.DB, { ...current, stage: 'scripting', audioJob: null }, current.version);
    await expect(run(p)).rejects.toThrow('旧音频');
    expect((await getProduction(env.DB, p.id)).audioJob).toBeNull();
    await env.DB.prepare('DELETE FROM productions').run();
    await setAudioState(env, snapshot, 'failed', 'stale');
  });
  it('sanitizes unexpected network failures and preserves retryable provider errors', async () => {
    const p = await start();
    vi.spyOn(audio, 'synthesizeSpeech').mockRejectedValue(new Error('sensitive-provider-response'));
    await expect(run(p)).rejects.toThrow('音频制作失败');
    expect((await getProduction(env.DB, p.id)).audioJob?.error).not.toContain('sensitive');
    vi.mocked(audio.synthesizeSpeech).mockRejectedValue(
      new audio.AudioError('语音服务请求失败（HTTP 503）', true),
    );
    await expect(run(await getProduction(env.DB, p.id))).rejects.toThrow('HTTP 503');
  });
});

it('routes token APIs outside Access and blocks human cross-origin mutation', async () => {
  const login = await worker.fetch(request('/admin/api/dev-login', 'POST'), env);
  const cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  const createToken = request('/admin/api/agent-tokens', 'POST', { name: 'Hermes', expiresInDays: 30 });
  createToken.headers.set('Cookie', cookie);
  const tokenResponse = await worker.fetch(createToken, env);
  const { token } = (await tokenResponse.json()) as { token: string };
  const list = new Request(`${origin}/api/agent/productions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await worker.fetch(list, env)).status).toBe(200);
  expect(
    (await worker.fetch(new Request(`${origin}/api/agent/unknown`, { headers: list.headers }), env)).status,
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request(`${origin}/api/agent/production-settings`, { headers: list.headers }),
        env,
      )
    ).status,
  ).toBe(403);
  expect((await worker.fetch(request('/api/agent/productions'), env)).status).toBe(401);
  const settings = request('/admin/api/production-settings');
  settings.headers.set('Cookie', cookie);
  expect((await worker.fetch(settings, env)).status).toBe(200);
  const unknown = request('/admin/api/productions/missing/path');
  unknown.headers.set('Cookie', cookie);
  expect((await worker.fetch(unknown, env)).status).toBe(404);
  const unsafe = request('/admin/api/productions', 'POST', {});
  unsafe.headers.set('Cookie', cookie);
  unsafe.headers.set('Origin', 'https://evil.example');
  expect((await worker.fetch(unsafe, env)).status).toBe(403);
});

it('protects published workflow snapshots from legacy catalog mutations', async () => {
  const production = readyFixture();
  await env.DB.prepare('INSERT INTO productions VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      production.id,
      production.version,
      production.stage,
      JSON.stringify(production),
      production.createdAt,
      production.updatedAt,
    )
    .run();
  const { publishProduction } = await import('../../worker/production');
  await publishProduction(
    env.DB,
    production,
    {
      version: 1,
      platform: 'xiaoyuzhou',
      url: 'https://www.xiaoyuzhoufm.com/episode/test',
      publishedAt: '2026-09-01T00:00:00.000Z',
    },
    human,
  );
  const login = await worker.fetch(request('/admin/api/dev-login', 'POST'), env);
  const cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  for (const method of ['PUT', 'DELETE']) {
    const mutation = request(`/admin/api/episodes/${production.id}`, method, {});
    mutation.headers.set('Cookie', cookie);
    expect((await worker.fetch(mutation, env)).status).toBe(409);
  }
});

describe('private cloud voice previews', () => {
  const input = {
    voice: 'Vindemiatrix',
    speakingStyle: '中文，温柔自然',
    text: '今天的工作到这里，我们回家吃饭。',
  };
  it('validates requests, keeps previews owner-only and never returns credentials', async () => {
    expect((await call('/production-settings/preview', 'POST', input, agent))?.status).toBe(403);
    expect((await call('/production-settings/preview', 'GET'))?.status).toBe(405);
    for (const invalid of [
      { ...input, voice: 'not-a-voice' },
      { ...input, text: '字'.repeat(201) },
      { ...input, text: '' },
    ])
      expect((await call('/production-settings/preview', 'POST', invalid))?.status).toBe(400);
    await expect(
      routeAudio(
        request('/production-settings/preview', 'POST', input),
        { ...env, GEMINI_API_KEY: '' },
        '/production-settings/preview',
        human,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const synthesize = vi
      .spyOn(audio, 'synthesizeSpeech')
      .mockResolvedValue({ bytes, info: audio.parseWav(bytes), interactionId: 'preview' });
    const first = await call('/production-settings/preview', 'POST', input);
    expect(first?.status).toBe(200);
    const result = await first?.json();
    expect(result).toMatchObject({
      preview: {
        ...input,
        durationSeconds: 1,
        cached: false,
        url: expect.stringContaining('/media/audio/previews/'),
      },
    });
    expect(JSON.stringify(result)).not.toContain('test-only-key');
    expect(await (await call('/production-settings/preview', 'POST', input))?.json()).toMatchObject({
      preview: { cached: true },
    });
    expect(synthesize).toHaveBeenCalledOnce();
    await call('/production-settings/preview', 'POST', { ...input, voice: 'Sulafat' });
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect((await getSettings(env)).voice).toBe('Kore');
  });
  it('returns sanitized provider and transport errors', async () => {
    const synthesize = vi
      .spyOn(audio, 'synthesizeSpeech')
      .mockRejectedValue(new Error('secret-provider-response'));
    expect(
      await (await call('/production-settings/preview', 'POST', { ...input, text: '失败重试' }))?.text(),
    ).toBe('试听生成暂时失败，请重试');
    synthesize.mockRejectedValue(new audio.AudioError('语音服务请求失败（HTTP 429）', true));
    const response = await call('/production-settings/preview', 'POST', { ...input, text: '限流重试' });
    expect(response?.status).toBe(502);
    expect(await response?.text()).toContain('HTTP 429');
  });
});
