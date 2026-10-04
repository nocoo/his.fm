import { readdirSync, readFileSync } from 'node:fs';
import { type AiStatus, defaultSpeechSettings, type SpeechSnapshot, wavHeader } from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Production } from '../../src/shared/production';
import { routeAgentTokens } from '../../worker/agent-tokens';
import { routeAiSettings } from '../../worker/ai-settings';
import * as audio from '../../worker/audio';
import { routeAudio, triggerAudio } from '../../worker/audio-routes';
import { getAudioSnapshot, getSettings, requireActiveAudio, setAudioState } from '../../worker/audio-store';
import { routeBumpers } from '../../worker/bumpers';
import { HttpError } from '../../worker/http';
import worker from '../../worker/index';
import { queueSpeech, routeNativeSpeech, speechResult } from '../../worker/native-speech';
import { getProduction, saveProduction } from '../../worker/production-store';
import { agent, human, readyFixture } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
let mf: Miniflare;
let env: Env;
let token = '';
let config: AiStatus;
const origin = 'https://hisfm.dev.hexly.ai';
const bytes = new Uint8Array(48044);
bytes.set(wavHeader(48000));
function request(path: string, method = 'GET', data?: unknown) {
  return new Request(origin + path, {
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
async function insert() {
  const p = readyFixture({ stage: 'production', assets: { cover: null, audio: null }, audioJob: null });
  await env.DB.prepare('INSERT INTO productions VALUES (?, ?, ?, ?, ?, ?)')
    .bind(p.id, p.version, p.stage, JSON.stringify(p), p.createdAt, p.updatedAt)
    .run();
  return p;
}
async function start(options: Record<string, unknown> = {}) {
  const p = await insert();
  const response = await call(`/productions/${p.id}/audio`, 'POST', { version: p.version, ...options });
  expect(response?.status).toBe(202);
  if (!response) throw new Error('Missing response');
  return ((await response.json()) as { production: Production }).production;
}
async function native(id: string, method = 'GET', body?: Uint8Array, headers: Record<string, string> = {}) {
  const commandId = await env.DB.prepare('SELECT command_id FROM speech_jobs WHERE id=?')
    .bind(id)
    .first<string>('command_id');
  return routeNativeSpeech(
    new Request(`${origin}/api/agent/runtime/speech/${id}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Hisfm-Station': 'speech-test',
        'X-Hisfm-Generation': 'generation',
        'X-Hisfm-Command': commandId ?? 'missing',
        ...(body ? { 'Content-Length': String(body.byteLength) } : {}),
        ...headers,
      },
      ...(body ? { body: Uint8Array.from(body) } : {}),
    }),
    env,
  );
}
beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'native-speech-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'speech' },
            MEDIA: { type: 'r2', name: 'speech' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  const bucket = env.MEDIA;
  env.MEDIA = new Proxy(bucket, {
    get(target, property) {
      if (property === 'put')
        return async (
          key: string,
          value: ReadableStream | ArrayBuffer | Uint8Array | string,
          options: R2PutOptions,
        ) =>
          bucket.put(
            key,
            value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value,
            options,
          );
      return Reflect.get(target, property);
    },
  });
  for (const name of readdirSync(new URL('../../migrations/', import.meta.url)).sort()) {
    await env.DB.batch(
      readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
  }
});
afterAll(() => mf.dispose());
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'FixedLengthStream',
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(length: number) {
        let received = 0;
        super({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > length) throw new Error('Too many bytes');
            controller.enqueue(chunk);
          },
          flush() {
            if (received !== length) throw new Error('Missing bytes');
          },
        });
      }
    },
  );
  await env.DB.batch(
    [
      'speech_jobs',
      'bumpers',
      'audio_jobs',
      'productions',
      'production_settings',
      'agent_station',
      'agent_receipts',
      'agent_commands',
      'agent_tokens',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  config = {
    version: '0'.repeat(64),
    settings: structuredClone(defaultSpeechSettings),
    providers: { gemini: true, elevenlabs: true, raven: true, decision: true },
    coordinator: { provider: 'raven', model: 'gpt-6-astra', thinkingLevel: 'high' },
    executor: { provider: 'raven', model: 'gpt-6.1-sol', thinkingLevels: ['low', 'medium', 'high'] },
    decision: { model: 'jev-latest', maxInputBytes: 16384, maxBatchQuestions: 12 },
  };
  env.AGENT_HUB = {
    getByName: () => ({
      fetch: async (input: string | Request) =>
        new URL(typeof input === 'string' ? input : input.url).pathname === '/runtime-request'
          ? Response.json(config)
          : Response.json({ ok: true }),
    }),
  } as unknown as DurableObjectNamespace;
  const result = await routeAgentTokens(
    request('/admin/api/agent-tokens', 'POST', { name: 'Speech', expiresInDays: 1 }),
    env,
    '/admin/api/agent-tokens',
  );
  const created = (await result.json()) as { token: string; record: { id: string } };
  token = created.token;
  await env.DB.prepare('INSERT INTO agent_station VALUES (1, ?, ?, 1, ?, ?)')
    .bind(created.record.id, 'speech-test', 'generation', Date.now() + 600000)
    .run();
  const objects = await env.MEDIA.list();
  for (const item of objects.objects) await env.MEDIA.delete(item.key);
});
describe('native speech jobs', () => {
  const sample: SpeechSnapshot = {
    provider: 'elevenlabs',
    model: 'eleven_v4',
    voice: 'voice123',
    speakingStyle: 'calm',
    text: '你好，这里是 his.fm。',
    stability: 0.5,
    similarity: 0.75,
  };
  it('returns only safe configuration, detects offline runtimes and validates owner requests', async () => {
    expect(await getSettings(env)).toMatchObject({ provider: 'gemini', ttsConfigured: true, bumpers: [] });
    expect((await call('/production-settings', 'GET', undefined, agent))?.status).toBe(403);
    expect(await call('/unrelated')).toBeNull();
    expect((await call('/production-settings', 'PUT', {}))?.status).toBe(404);
    expect((await routeAiSettings(request('/admin/api/ai-settings'), env)).status).toBe(200);
    expect(
      (
        await routeAiSettings(
          request('/admin/api/ai-settings', 'PUT', { version: config.version, settings: config.settings }),
          env,
        )
      ).status,
    ).toBe(200);
    await expect(routeAiSettings(request('/admin/api/ai-settings', 'DELETE'), env)).rejects.toMatchObject({
      status: 405,
    });
    config.providers.gemini = false;
    expect((await getSettings(env)).ttsConfigured).toBe(false);
    const input = { provider: 'gemini', voice: 'Kore', speakingStyle: 'calm', text: '你好' };
    expect((await call('/production-settings/preview', 'POST', input))?.status).toBe(409);
    expect((await call('/production-settings/preview', 'GET'))?.status).toBe(405);
    config.providers.gemini = true;
    expect(
      (await call('/production-settings/preview', 'POST', { ...input, text: '字'.repeat(201) }))?.status,
    ).toBe(400);
    env.AGENT_HUB = {
      getByName: () => ({ fetch: async () => new Response(null, { status: 503 }) }),
    } as unknown as DurableObjectNamespace;
    await expect(getSettings(env)).rejects.toMatchObject({ status: 503 });
  });
  it('requires approval and snapshots voice, provider, style and independent bumper choices', async () => {
    const p = await insert();
    const path = `/productions/${p.id}/audio`;
    expect((await call(path, 'GET'))?.status).toBe(405);
    expect((await call(path, 'POST', { version: 99 }))?.status).toBe(409);
    expect((await call(path, 'POST', { version: 1, introId: 'missing' }))?.status).toBe(409);
    config.providers.gemini = false;
    expect((await call(path, 'POST', { version: 1 }))?.status).toBe(409);
    config.providers.gemini = true;
    await saveProduction(env.DB, { ...p, approvals: { ...p.approvals, script: null } }, p.version);
    expect((await call(path, 'POST', { version: 2 }))?.status).toBe(409);
    await expect(getAudioSnapshot(env.DB, 'missing')).rejects.toMatchObject({ status: 404 });
  });
  it('queues a production once and accepts only leased, scoped uploads with immutable replay', async () => {
    const p = await start({ provider: 'elevenlabs', voice: 'voice123', speakingStyle: 'warm' });
    const id = p.audioJob?.id ?? '';
    const snapshot = await getAudioSnapshot(env.DB, id);
    expect(snapshot.speech).toMatchObject({
      provider: 'elevenlabs',
      voice: 'voice123',
      speakingStyle: 'warm',
      model: 'eleven_v4',
    });
    expect(snapshot.introKey).toBeNull();
    expect(snapshot.outroKey).toBeNull();
    await triggerAudio(env, id);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM speech_jobs').first('n')).toBe(1);
    expect((await call(`/productions/${p.id}/audio`, 'POST', { version: p.version }))?.status).toBe(200);
    expect(await (await native(id)).json()).toMatchObject({ input: snapshot.speech, complete: false });
    await expect(native(id, 'GET', undefined, { 'X-Hisfm-Generation': 'stale' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(native(id, 'GET', undefined, { 'X-Hisfm-Command': 'wrong' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(native('missing')).rejects.toMatchObject({ status: 403 });
    expect((await native(id, 'POST')).status).toBe(200);
    expect((await getProduction(env.DB, p.id)).audioJob?.status).toBe('running');
    const completed = await (await native(id, 'PUT', bytes)).json();
    expect(completed).toMatchObject({ complete: true, result: { durationSeconds: 1 } });
    const production = await getProduction(env.DB, p.id);
    expect(production.audioJob?.status).toBe('complete');
    expect(production.assets.audio?.includesBumpers).toBe(false);
    expect(await (await native(id, 'PUT', new Uint8Array(1))).json()).toEqual(completed);
    await setAudioState(env, snapshot, 'running');
    await setAudioState(env, snapshot, 'failed', 'late');
    expect(await getProduction(env.DB, p.id)).toEqual(production);
  });
  it('creates content-addressed previews and reuses completed media without provider calls', async () => {
    const input = {
      provider: sample.provider,
      voice: sample.voice,
      speakingStyle: sample.speakingStyle,
      text: sample.text,
    };
    const response = await call('/production-settings/preview', 'POST', input);
    expect(response?.status).toBe(202);
    if (!response) throw new Error('Missing response');
    const { jobId } = (await response.json()) as { jobId: string };
    expect((await speechResult(env, jobId)).status).toBe(202);
    await native(jobId, 'POST');
    await native(jobId, 'PUT', bytes);
    expect(await (await speechResult(env, jobId)).json()).toMatchObject({
      preview: { provider: 'elevenlabs', durationSeconds: 1 },
    });
    expect(await (await call('/production-settings/preview', 'POST', input))?.json()).toMatchObject({
      preview: { cached: true },
    });
    await expect(speechResult(env, 'missing')).rejects.toMatchObject({ status: 404 });
  });
  it('marks failed native work and rejects cancellation, stale scripts and invalid audio', async () => {
    const p = await start();
    const id = p.audioJob?.id ?? '';
    const snapshot = await getAudioSnapshot(env.DB, id);
    expect(() => requireActiveAudio({ ...p, scriptVersion: 2 }, snapshot)).toThrow('旧音频');
    await expect(native(id, 'PATCH')).rejects.toMatchObject({ status: 405 });
    await expect(native(id, 'PUT', new Uint8Array(2))).rejects.toMatchObject({ status: 400 });
    await native(id, 'DELETE');
    expect((await getProduction(env.DB, p.id)).audioJob?.status).toBe('failed');
    await env.DB.prepare("UPDATE agent_commands SET status='cancelling' WHERE id=?")
      .bind(
        await env.DB.prepare('SELECT command_id FROM speech_jobs WHERE id=?').bind(id).first('command_id'),
      )
      .run();
    await expect(native(id)).rejects.toMatchObject({ status: 409 });
    await queueSpeech(env, 'preview-fail', 'preview', sample, null);
    await native('preview-fail', 'DELETE');
    await expect(speechResult(env, 'preview-fail')).rejects.toMatchObject({ status: 502 });
  });
  it('stores multiple named bumpers and snapshots independent intro/outro selection', async () => {
    const upload = () =>
      routeBumpers(
        new Request(`${origin}/admin/api/bumpers?name=Opening&position=intro`, {
          method: 'POST',
          body: bytes,
        }),
        env,
      );
    const { bumper } = (await (await upload()).json()) as { bumper: { id: string; key: string } };
    expect((await (await routeBumpers(request('/admin/api/bumpers'), env)).json()) as unknown).toMatchObject({
      bumpers: [{ id: bumper.id, name: 'Opening', position: 'intro' }],
    });
    const p = await start({ introId: bumper.id });
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    expect(snapshot.introKey).toBe(bumper.key);
    expect(snapshot.outroKey).toBeNull();
    await expect(routeBumpers(request('/admin/api/bumpers', 'PUT'), env)).rejects.toMatchObject({
      status: 405,
    });
    await expect(
      routeBumpers(new Request(`${origin}/admin/api/bumpers`, { method: 'POST', body: bytes }), env),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      routeBumpers(
        new Request(`${origin}/admin/api/bumpers?name=Bad&position=intro`, {
          method: 'POST',
          body: new Uint8Array(2),
        }),
        env,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rolls back production and job together on a completion failure', async () => {
    const p = await start();
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    const asset = {
      key: 'audio/test.wav',
      url: '/media/audio/test.wav',
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
    } finally {
      await env.DB.prepare('DROP TRIGGER reject_audio_complete').run();
    }
    await expect(setAudioState(env, snapshot, 'complete')).rejects.toMatchObject({ status: 400 });
  });
  it('assembles independent bumpers, reuses existing output and rejects oversized clips', async () => {
    await env.MEDIA.put('bumpers/intro.wav', bytes);
    await env.DB.prepare("INSERT INTO bumpers (id,name,position,data) VALUES ('intro','Opening','intro',?)")
      .bind(
        JSON.stringify({
          key: 'bumpers/intro.wav',
          url: '/media/bumpers/intro.wav',
          durationSeconds: 1,
          size: bytes.length,
        }),
      )
      .run();
    const p = await start({ introId: 'intro' });
    const id = p.audioJob?.id ?? '';
    const compose = vi.spyOn(audio, 'composeWav').mockImplementation(async (bucket, _parts, key) => {
      await bucket.put(key, bytes);
      return { key, bytes: bytes.length, durationSeconds: 1 };
    });
    await native(id, 'POST');
    await native(id, 'PUT', bytes);
    expect(compose).toHaveBeenCalledTimes(2);
    expect((await getProduction(env.DB, p.id)).assets.audio?.includesBumpers).toBe(true);
    await env.DB.prepare("UPDATE speech_jobs SET status='running',result=NULL WHERE id=?").bind(id).run();
    await native(id, 'PUT', bytes);
    expect(compose).toHaveBeenCalledTimes(2);
    const long = new Uint8Array(31 * 48000 + 44);
    long.set(wavHeader(long.length - 44));
    await expect(
      routeBumpers(
        new Request(`${origin}/admin/api/bumpers?name=Long&position=outro`, { method: 'POST', body: long }),
        env,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await queueSpeech(env, 'oversize', 'preview', sample, null);
    const oversized = new Uint8Array(121 * 48000 + 44);
    oversized.set(wavHeader(oversized.length - 44));
    await expect(native('oversize', 'PUT', oversized)).rejects.toMatchObject({ status: 400 });
    await expect(native('oversize', 'PUT', new Uint8Array([...bytes, 1]))).rejects.toMatchObject({
      status: 400,
    });
  });
  it('retains failed job identity while creating a new explicit attempt and handles lost production scope', async () => {
    await queueSpeech(env, 'retry', 'preview', sample, null);
    const first = await env.DB.prepare("SELECT command_id FROM speech_jobs WHERE id='retry'").first(
      'command_id',
    );
    await env.DB.prepare("UPDATE agent_commands SET status='failed' WHERE id=?").bind(first).run();
    await queueSpeech(env, 'retry', 'preview', sample, null);
    expect(
      await env.DB.prepare("SELECT command_id FROM speech_jobs WHERE id='retry'").first('command_id'),
    ).not.toBe(first);
    await expect(triggerAudio(env, 'missing')).rejects.toMatchObject({ status: 404 });
    const p = await start();
    const snapshot = await getAudioSnapshot(env.DB, p.audioJob?.id ?? '');
    await setAudioState(env, snapshot, 'running');
    const current = await getProduction(env.DB, p.id);
    await setAudioState(env, snapshot, 'running');
    expect(await getProduction(env.DB, p.id)).toEqual(current);
    await saveProduction(env.DB, { ...current, stage: 'scripting', audioJob: null }, current.version);
    await expect(setAudioState(env, snapshot, 'complete')).rejects.toMatchObject({ status: 409 });
    await setAudioState(env, snapshot, 'failed');
    expect(
      await env.DB.prepare('SELECT status FROM audio_jobs WHERE id=?').bind(snapshot.jobId).first('status'),
    ).toBe('failed');
    await env.DB.prepare('DELETE FROM audio_jobs WHERE id=?').bind(snapshot.jobId).run();
    await setAudioState(env, snapshot, 'failed');
  });
  it('enforces station revocation and bounded commit contention', async () => {
    const p = await start();
    const id = p.audioJob?.id ?? '';
    const snapshot = await getAudioSnapshot(env.DB, id);
    const raced = {
      ...env,
      DB: {
        prepare: env.DB.prepare.bind(env.DB),
        batch: async () => [{ meta: { changes: 0 } }],
      } as unknown as D1Database,
    };
    await expect(setAudioState(raced, snapshot, 'running')).rejects.toMatchObject({ status: 409 });
    await env.DB.prepare('UPDATE agent_station SET lease_until=0').run();
    await expect(native(id)).rejects.toMatchObject({ status: 403 });
    await env.DB.prepare('DELETE FROM agent_station').run();
    await expect(native(id)).rejects.toMatchObject({ status: 403 });
  });
  it('routes owner settings and bumper reads without exposing private values', async () => {
    const login = await worker.fetch(request('/admin/api/dev-login', 'POST'), env);
    const cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    for (const path of [
      '/admin/api/ai-settings',
      '/admin/api/bumpers',
      '/admin/api/production-settings/previews',
    ]) {
      const input = request(path);
      input.headers.set('Cookie', cookie);
      expect((await worker.fetch(input, env)).status).toBe(200);
    }
    const input = request('/admin/api/ai-settings', 'PUT', {
      version: config.version,
      settings: config.settings,
    });
    input.headers.set('Cookie', cookie);
    expect((await worker.fetch(input, env)).status).toBe(200);
    const bad = {
      ...env,
      AGENT_HUB: {
        getByName: () => ({ fetch: async () => Response.json({ config: 'invalid' }) }),
      } as unknown as DurableObjectNamespace,
    };
    await expect(getSettings(bad)).rejects.toMatchObject({ status: 502 });
    const preview = request('/admin/api/production-settings/preview', 'POST', {
      provider: 'gemini',
      voice: 'Kore',
      speakingStyle: 'calm',
      text: 'Hello',
    });
    preview.headers.set('Cookie', cookie);
    expect((await worker.fetch(preview, env)).status).toBe(202);
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
