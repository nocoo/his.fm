import { readFileSync } from 'node:fs';
import { defaultSpeechSettings, wavHeader } from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, Production } from '../../src/shared/production';
import { productionCapabilities } from '../../worker/agent-api';
import { authenticateAgent, routeAgentTokens } from '../../worker/agent-tokens';
import * as aiSettings from '../../worker/ai-settings';
import { routeAudio } from '../../worker/audio-routes';
import { HttpError, json } from '../../worker/http';
import { publishProduction, routeProductions } from '../../worker/production';
import { getProduction, projectProduction, saveProduction } from '../../worker/production-store';
import { agent, brief, fixture, fullAgent, human, readyFixture } from './production-fixture';

const origin = 'https://hisfm.dev.hexly.ai';
const publication = {
  version: 1,
  platform: 'wechat' as const,
  url: 'https://mp.weixin.qq.com/s/original',
  publishedAt: '2026-09-24T00:00:00.000Z',
};
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const wav = new Uint8Array(48);
wav.set(wavHeader(4));
let miniflare: Miniflare;
let env: Env;

async function call(path: string, method = 'GET', body?: unknown, actor = fullAgent, bindings = env) {
  const binary = body instanceof Uint8Array;
  const request = new Request(`${origin}${path}`, {
    method,
    headers: binary
      ? {
          'Content-Type': path.includes('/audio') ? 'audio/wav' : 'image/png',
          'Content-Length': String(body.length),
        }
      : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: binary ? Uint8Array.from(body) : JSON.stringify(body) }),
  });
  try {
    const path = new URL(request.url).pathname;
    return (
      (await routeAudio(request, bindings, path, actor)) ??
      (await routeProductions(request, bindings, path, actor)) ??
      json({}, 404)
    );
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }
}

async function result(response: Response) {
  const body = (await response.json()) as { production: Production };
  expect(response.status, JSON.stringify(body)).toBeLessThan(300);
  return body.production;
}

async function insert(production: Production) {
  await env.DB.prepare(
    'INSERT INTO productions (id, version, stage, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
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

beforeAll(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'production-scopes-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'production-scopes-test' },
            MEDIA: { type: 'r2', name: 'production-scopes-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await miniflare.getBindings<Env>();
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
  for (const file of [
    '0001_episodes.sql',
    '0003_production.sql',
    '0004_audio.sql',
    '0005_channel.sql',
    '0007_agent_runtime.sql',
    '0009_native_speech.sql',
    '0010_categories.sql',
    '0011_prompts.sql',
    '0012_token_scopes.sql',
    '0013_resource_versions.sql',
  ]) {
    const sql = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    await env.DB.batch(
      sql
        .split(';')
        .filter((statement) => statement.trim())
        .map((statement) => env.DB.prepare(statement)),
    );
  }
}, 30000);

beforeEach(async () => {
  await env.DB.batch(
    ['speech_jobs', 'agent_commands', 'agent_tokens', 'audio_jobs', 'episodes', 'productions'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await miniflare?.dispose();
});

describe('production scope enforcement and projections', () => {
  it.each(['final_review', 'ready'] as const)(
    'reports strict reopening requirements for editing and assets in %s',
    (stage) => {
      const production = readyFixture({ stage });
      const approver: Actor = {
        ...fullAgent,
        scopes: fullAgent.scopes?.filter((scope) => scope !== 'productions:reopen'),
      };
      const reopener: Actor = {
        ...fullAgent,
        scopes: fullAgent.scopes?.filter((scope) => scope !== 'productions:approve'),
      };
      const capabilities = productionCapabilities(production, approver, origin);
      expect(capabilities).toMatchObject({
        editableFields: [],
        canUploadCover: false,
        canGenerateAudio: false,
        blockedActions: {
          reopen_brief: 'Missing scope: productions:reopen',
          reopen_script: 'Missing scope: productions:reopen',
          reopen_assets: 'Missing scope: productions:reopen',
          revise_assets: 'Missing scope: productions:reopen',
        },
      });
      const reopened = productionCapabilities(production, reopener, origin);
      expect(reopened).toMatchObject({ canUploadCover: true, canGenerateAudio: true });
      expect(reopened.editableFields).toEqual(expect.arrayContaining(['category', 'transcript', 'summary']));
      expect(reopened.blockedActions.approve_final).toBe('Missing scope: productions:approve');
      expect(reopened.availableActions).toEqual(
        expect.arrayContaining(['reopen_brief', 'reopen_script', 'reopen_assets']),
      );
      if (stage === 'final_review') expect(capabilities.availableActions).toContain('approve_final');
      const editable = productionCapabilities({ ...production, stage: 'production' }, approver, origin);
      expect(editable).toMatchObject({ canUploadCover: true, canGenerateAudio: true });
      expect(editable.editableFields).toContain('summary');
      expect(editable.editableFields).not.toContain('category');
      expect(productionCapabilities(production, human, origin).canGenerateAudio).toBe(true);
    },
  );

  it('fails closed without grants and separates content, approval, reopening and deletion', async () => {
    const production = await insert(readyFixture({ stage: 'production' }));
    const path = `/productions/${production.id}`;
    const unscoped: Actor = { kind: 'agent', name: 'Legacy' };
    for (const [url, method, body] of [
      ['/productions', 'GET', undefined],
      ['/productions', 'POST', brief],
      [path, 'GET', undefined],
      [path, 'PUT', { version: 1, summary: 'No grant' }],
      [`${path}?version=1`, 'DELETE', undefined],
      [`${path}/publications`, 'GET', undefined],
      [`${path}/publications`, 'POST', publication],
      [`${path}/publications/wechat`, 'PATCH', publication],
      [`${path}/publications/wechat?version=1`, 'DELETE', undefined],
      [`${path}/prompts`, 'GET', undefined],
      [`${path}/assets/cover?version=1`, 'PUT', png],
      [`${path}/assets/audio?version=1`, 'PUT', wav],
      [
        `${path}/assets/audio/bind`,
        'POST',
        { version: 1, key: 'uploads/00000000-0000-4000-8000-000000000001.wav' },
      ],
      [`${path}/assets/audio?version=1`, 'DELETE', undefined],
    ] as const)
      expect((await call(url, method, body, unscoped)).status).toBe(403);
    expect(
      (await call(`${path}/prompts`, 'GET', undefined, { ...agent, scopes: ['prompts:read'] })).status,
    ).toBe(403);
    expect(
      (await call(`${path}/prompts`, 'GET', undefined, { ...agent, scopes: ['productions:read'] })).status,
    ).toBe(403);
    for (const action of ['approve_final', 'reopen_brief', 'revise_assets'])
      expect(
        (await call(`${path}/actions`, 'POST', { version: 1, action, feedback: 'No authority' }, agent))
          .status,
      ).toBe(403);
    expect((await call(path, 'PUT', { version: 1, category: 'work' }, agent)).status).toBe(403);
    expect((await call(`${path}/assets/cover?version=1`, 'PUT', png, agent)).status).toBe(403);
    expect((await call(`${path}/assets/audio?version=1`, 'PUT', wav, agent)).status).toBe(403);
    expect(
      (
        await call(
          `${path}/assets/audio/bind`,
          'POST',
          {
            version: 1,
            key: 'uploads/00000000-0000-4000-8000-000000000001.wav',
          },
          agent,
        )
      ).status,
    ).toBe(403);
    expect((await call(`${path}/assets/audio?version=1`, 'DELETE', undefined, agent)).status).toBe(403);
    expect((await getProduction(env.DB, production.id)).version).toBe(1);
  });

  it('redacts prompts and publication metadata from reads and every mutation response', async () => {
    let production = await insert(readyFixture());
    production = await publishProduction(env.DB, production, publication, fullAgent);
    const actor: Actor = {
      ...fullAgent,
      scopes: fullAgent.scopes?.filter((scope) => !['prompts:read', 'publications:read'].includes(scope)),
    };
    const path = `/productions/${production.id}`;
    const detail = (await (await call(path, 'GET', undefined, actor)).json()) as {
      production: Production;
      categoryProfile: Record<string, unknown>;
    };
    expect(detail.categoryProfile).not.toHaveProperty('prompt');
    expect(detail.production.publications).toEqual([]);
    expect(detail.production.events).toEqual([]);
    expect(await (await call('/productions', 'GET', undefined, actor)).json()).toEqual({
      productions: [detail.production],
    });
    const patched = await result(
      await call(path, 'PUT', { version: production.version, tags: ['New tag'] }, actor),
    );
    expect(patched.publications).toEqual([]);
    expect(JSON.stringify(patched)).not.toContain(publication.url);
    const raw = await getProduction(env.DB, production.id);
    expect(raw.publications).toHaveLength(1);
    expect(projectProduction(raw, fullAgent)).toBe(raw);
    expect(await (await call(`${path}/publications`)).json()).toEqual({ publications: raw.publications });
    const prompts = await (await call(`${path}/prompts`, 'GET', undefined, agent)).text();
    expect(prompts).not.toContain(publication.url);
    const withdrawn = await result(
      await call(`${path}/publications/wechat?version=${raw.version}`, 'DELETE', undefined, actor),
    );
    expect(JSON.stringify(withdrawn)).not.toContain(publication.url);
  });

  it('runs an all-grant workflow with real uploaded assets and agent audit identity', async () => {
    let production = await result(await call('/productions', 'POST', brief));
    const path = `/productions/${production.id}`;
    production = await result(
      await call(
        `${path}/actions`,
        'POST',
        {
          version: production.version,
          action: 'submit_brief',
          changes: { intent: 'An explicitly saved brief' },
        },
        agent,
      ),
    );
    production = await result(
      await call(`${path}/actions`, 'POST', { version: production.version, action: 'approve_brief' }),
    );
    production = await result(
      await call(path, 'PUT', { version: production.version, transcript: 'A reviewed script.' }),
    );
    production = await result(
      await call(`${path}/actions`, 'POST', { version: production.version, action: 'submit_script' }),
    );
    production = await result(
      await call(`${path}/actions`, 'POST', { version: production.version, action: 'approve_script' }),
    );
    production = await result(
      await call(path, 'PUT', {
        version: production.version,
        summary: 'Summary',
        description: 'Description',
      }),
    );
    production = await result(await call(`${path}/assets/cover?version=${production.version}`, 'PUT', png));
    production = await result(await call(`${path}/assets/audio?version=${production.version}`, 'PUT', wav));
    expect(production.audioJob).toBeNull();
    expect(production.assets.audio).toMatchObject({
      source: 'upload',
      size: wav.length,
      scriptVersion: production.scriptVersion,
      durationSeconds: 4 / 48000,
    });
    production = await result(
      await call(`${path}/actions`, 'POST', { version: production.version, action: 'submit_final' }),
    );
    production = await result(
      await call(`${path}/actions`, 'POST', { version: production.version, action: 'approve_final' }),
    );
    production = await result(
      await call(`${path}/publications`, 'POST', { ...publication, version: production.version }),
    );
    expect(production.stage).toBe('ready');
    expect(production.publications[0].confirmedBy).toBe(fullAgent.name);
    expect(production.events.every((event) => event.actor.kind === 'agent')).toBe(true);
    expect(production.approvals.final?.by).toBe(fullAgent.name);
    expect(
      await env.DB.prepare('SELECT status, version, audio_url FROM episodes WHERE id = ?')
        .bind(production.id)
        .first(),
    ).toEqual({ status: 'published', version: 1, audio_url: production.assets.audio?.url });
  });
});

describe('versioned publication lifecycle', () => {
  it('corrects and withdraws snapshots atomically while preserving audit and episode versions', async () => {
    let production = await insert(readyFixture());
    const path = `/productions/${production.id}`;
    production = await result(await call(`${path}/publications`, 'POST', publication));
    await env.DB.prepare('UPDATE episodes SET featured = 1, version = version + 1 WHERE id = ?')
      .bind(production.id)
      .run();
    expect(
      (await call(`${path}/publications`, 'POST', { ...publication, version: production.version })).status,
    ).toBe(409);
    expect((await call(`${path}/publications/wechat`, 'PATCH', publication)).status).toBe(409);
    expect(
      (
        await call(`${path}/publications/xiaoyuzhou`, 'PATCH', {
          ...publication,
          version: production.version,
        })
      ).status,
    ).toBe(400);
    const corrected = {
      ...publication,
      version: production.version,
      url: 'https://mp.weixin.qq.com/s/corrected',
    };
    production = await result(await call(`${path}/publications/wechat`, 'PATCH', corrected));
    expect(production.publications).toHaveLength(1);
    expect(production.publications[0].url).toBe(corrected.url);
    expect(production.events.at(-1)).toMatchObject({
      actor: fullAgent,
      action: 'correct_publication:wechat',
    });
    expect(production.events.at(-1)?.feedback).toContain(publication.url);
    expect(
      await env.DB.prepare('SELECT featured, version FROM episodes WHERE id = ?').bind(production.id).first(),
    ).toEqual({ featured: 1, version: 3 });
    production = await result(
      await call(`${path}/publications`, 'POST', {
        ...publication,
        version: production.version,
        platform: 'xiaoyuzhou',
        url: 'https://xiaoyuzhoufm.com/episode/test',
      }),
    );
    const snapshot = await env.DB.prepare('SELECT transcript FROM episodes WHERE id = ?')
      .bind(production.id)
      .first();
    production = await result(
      await call(path, 'PUT', { version: production.version, transcript: 'Unapproved new script' }),
    );
    expect(
      (await call(`${path}/publications/wechat`, 'PATCH', { ...corrected, version: production.version }))
        .status,
    ).toBe(409);
    expect((await call(`${path}/publications/wechat?version=1`, 'DELETE')).status).toBe(409);
    production = await result(
      await call(`${path}/publications/wechat?version=${production.version}`, 'DELETE'),
    );
    expect(
      await env.DB.prepare('SELECT status, transcript, version FROM episodes WHERE id = ?')
        .bind(production.id)
        .first(),
    ).toEqual({ ...snapshot, status: 'published', version: 5 });
    production = await result(
      await call(`${path}/publications/xiaoyuzhou?version=${production.version}`, 'DELETE'),
    );
    expect(
      await env.DB.prepare('SELECT status, published_at, transcript, version FROM episodes WHERE id = ?')
        .bind(production.id)
        .first(),
    ).toEqual({ ...snapshot, status: 'draft', published_at: null, version: 6 });
    expect(production.publications).toEqual([]);
    expect(production.events.at(-1)?.action).toBe('withdraw_publication:xiaoyuzhou');
    expect((await call(`${path}?version=${production.version}`, 'DELETE')).status).toBe(409);
    expect((await call(`${path}/publications/wechat?version=${production.version}`, 'DELETE')).status).toBe(
      404,
    );
    expect((await call(`${path}/publications/wechat`, 'GET')).status).toBe(405);
    expect((await call(`${path}/events/anything`, 'DELETE')).status).toBe(404);
  });

  it('does not create missing publication records through correction or race a snapshot update', async () => {
    let production = await insert(readyFixture());
    const path = `/productions/${production.id}`;
    expect((await call(`${path}/publications/wechat`, 'PATCH', publication)).status).toBe(404);
    production = await publishProduction(env.DB, production, publication, fullAgent);
    const conflictDb = new Proxy(env.DB, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) =>
            target.prepare(sql.startsWith('UPDATE productions SET') ? `${sql} AND version = -1` : sql);
        return Reflect.get(target, key, receiver);
      },
    });
    expect(
      (
        await call(
          `${path}/publications/wechat?version=${production.version}`,
          'DELETE',
          undefined,
          fullAgent,
          { ...env, DB: conflictDb },
        )
      ).status,
    ).toBe(409);
    expect((await getProduction(env.DB, production.id)).publications).toHaveLength(1);
    expect(
      await env.DB.prepare('SELECT status, version FROM episodes WHERE id = ?').bind(production.id).first(),
    ).toEqual({ status: 'published', version: 1 });
  });
});

describe('manual assets and safe detach', () => {
  it.each([
    ['cover', 'PUT', png],
    ['audio', 'PUT', wav],
    ['cover', 'DELETE', undefined],
    ['audio', 'DELETE', undefined],
  ] as const)(
    'requires reopen rather than approve for %s %s after final approval',
    async (asset, method, body) => {
      const production = await insert(readyFixture());
      const path = `/productions/${production.id}/assets/${asset}?version=1`;
      const approver: Actor = {
        ...fullAgent,
        scopes: fullAgent.scopes?.filter((scope) => scope !== 'productions:reopen'),
      };
      const reopener: Actor = {
        ...fullAgent,
        scopes: fullAgent.scopes?.filter((scope) => scope !== 'productions:approve'),
      };
      expect((await call(path, method, body, approver)).status).toBe(409);
      expect(await getProduction(env.DB, production.id)).toEqual(production);
      const changed = await result(await call(path, method, body, reopener));
      expect(changed).toMatchObject({
        stage: 'production',
        version: 2,
        scriptVersion: production.scriptVersion,
        approvals: { brief: production.approvals.brief, script: production.approvals.script, final: null },
      });
      expect(changed.events.at(-1)?.actor).toEqual(reopener);
      if (method === 'DELETE') expect(changed.assets[asset]).toBeNull();
      else expect(await env.MEDIA.head(changed.assets[asset]?.key ?? '')).not.toBeNull();
    },
  );

  it('queues real audio work from a final-approved production only with independent reopen authority', async () => {
    const production = await insert(readyFixture());
    const path = `/productions/${production.id}/audio`;
    const approver: Actor = {
      ...fullAgent,
      scopes: fullAgent.scopes?.filter((scope) => scope !== 'productions:reopen'),
    };
    const denied = await call(path, 'POST', { version: 1 }, approver);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ error: '当前阶段生成音频需要 productions:reopen 权限' });
    expect(await getProduction(env.DB, production.id)).toEqual(production);
    expect((await env.DB.prepare('SELECT id FROM audio_jobs').all()).results).toEqual([]);
    const issued = await routeAgentTokens(
      new Request(`${origin}/admin/api/agent-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Reopen audio',
          expiresInDays: 1,
          scopes: fullAgent.scopes?.filter((scope) => scope !== 'productions:approve'),
        }),
      }),
      env,
      '/admin/api/agent-tokens',
      human,
    );
    const { token } = (await issued.json()) as { token: string };
    const reopener = await authenticateAgent(
      new Request(origin, { headers: { Authorization: `Bearer ${token}` } }),
      env,
    );
    vi.spyOn(aiSettings, 'runtimeConfiguration').mockResolvedValue({
      version: '0'.repeat(64),
      settings: defaultSpeechSettings,
      providers: { gemini: true, elevenlabs: true, raven: true, decision: true },
      coordinator: { provider: 'raven', model: 'gpt-6-astra', thinkingLevel: 'high' },
      executor: { provider: 'raven', model: 'gpt-6.1-sol', thinkingLevels: ['low'] },
      decision: { model: 'jev-latest', maxInputBytes: 16384, maxBatchQuestions: 12 },
    });
    const response = await call(path, 'POST', { version: 1 }, reopener);
    expect(response.status).toBe(202);
    const changed = await result(response);
    expect(changed).toMatchObject({
      stage: 'production',
      version: 2,
      scriptVersion: production.scriptVersion,
      approvals: { brief: production.approvals.brief, script: production.approvals.script, final: null },
      audioJob: { status: 'queued' },
      assets: { audio: null },
    });
    const job = await env.DB.prepare('SELECT snapshot, status FROM audio_jobs WHERE id = ?')
      .bind(changed.audioJob?.id)
      .first<{ snapshot: string; status: string }>();
    expect(job?.status).toBe('queued');
    expect(JSON.parse(job?.snapshot ?? '{}').principal).toEqual(reopener);
    expect(
      await env.DB.prepare('SELECT status FROM speech_jobs WHERE id = ?')
        .bind(changed.audioJob?.id)
        .first('status'),
    ).toBe('queued');
  });

  it('retains immutable bytes on detach and requires reopening authority after final approval', async () => {
    let production = await insert(readyFixture({ stage: 'production' }));
    const path = `/productions/${production.id}`;
    production = await result(await call(`${path}/assets/audio?version=1`, 'PUT', wav));
    const audioKey = production.assets.audio?.key ?? '';
    production = await saveProduction(env.DB, { ...production, stage: 'ready' }, production.version);
    const editor: Actor = { ...agent, scopes: [...(agent.scopes ?? []), 'storage:write'] };
    expect(
      (await call(`${path}/assets/audio?version=${production.version}`, 'PUT', wav, editor)).status,
    ).toBe(409);
    expect(
      (await call(`${path}/assets/audio?version=${production.version}`, 'DELETE', undefined, editor)).status,
    ).toBe(409);
    expect((await call(`${path}/assets/audio?version=1`, 'DELETE')).status).toBe(409);
    production = await result(await call(`${path}/assets/audio?version=${production.version}`, 'DELETE'));
    expect(production).toMatchObject({
      stage: 'production',
      assets: { audio: null },
      audioJob: null,
      scriptVersion: 1,
      approvals: { final: null },
    });
    expect(await env.MEDIA.head(audioKey)).not.toBeNull();
    production = await result(await call(`${path}/assets/cover?version=${production.version}`, 'DELETE'));
    expect(production.assets.cover).toBeNull();
    expect(production.approvals.script).not.toBeNull();
  });

  it('rejects stale, active, unapproved and invalid audio without fabricating successful jobs', async () => {
    let production = await insert(readyFixture({ stage: 'production' }));
    const path = `/productions/${production.id}`;
    expect((await call(`${path}/assets/audio?version=99`, 'PUT', wav)).status).toBe(409);
    expect((await call(`${path}/assets/audio?version=1`, 'PUT', new Uint8Array(44))).status).toBe(400);
    expect((await call(`${path}/assets/audio?version=1`, 'PUT', {})).status).toBe(415);
    production = await saveProduction(
      env.DB,
      {
        ...production,
        audioJob: { id: 'job', status: 'running', scriptVersion: 1, createdAt: '', error: null },
      },
      production.version,
    );
    expect((await call(`${path}/assets/audio?version=${production.version}`, 'PUT', wav)).status).toBe(409);
    expect((await call(`${path}/assets/audio?version=${production.version}`, 'DELETE')).status).toBe(409);
    expect((await call(`${path}?version=${production.version}`, 'DELETE')).status).toBe(409);
    production = await saveProduction(
      env.DB,
      { ...production, audioJob: null, approvals: { ...production.approvals, script: null } },
      production.version,
    );
    expect((await call(`${path}/assets/audio?version=${production.version}`, 'PUT', wav)).status).toBe(409);
    expect((await getProduction(env.DB, production.id)).assets.audio).toEqual(readyFixture().assets.audio);
    await insert(fixture({ id: 'draft' }));
    expect((await call('/productions/draft/assets/audio?version=1', 'PUT', wav)).status).toBe(409);
  });

  it('binds large audio uploaded out-of-band to R2 staging or production keys', async () => {
    let production = await insert(
      readyFixture({
        stage: 'production',
        audioJob: null,
        assets: { cover: readyFixture().assets.cover, audio: null },
      }),
    );
    const path = `/productions/${production.id}`;
    const staging = 'uploads/00000000-0000-4000-8000-000000000010.wav';
    await env.MEDIA.put(staging, wav);
    production = await result(
      await call(`${path}/assets/audio/bind`, 'POST', { version: production.version, key: staging }),
    );
    expect(production.assets.audio).toMatchObject({
      source: 'upload',
      mimeType: 'audio/wav',
      scriptVersion: production.scriptVersion,
      durationSeconds: 4 / 48000,
    });
    expect(production.assets.audio?.key).toMatch(
      new RegExp(`^productions/${production.id}/audio-${production.scriptVersion}-`),
    );
    expect(await env.MEDIA.head(staging)).toBeNull();
    const directKey = `productions/${production.id}/audio-${production.scriptVersion}-00000000-0000-4000-8000-000000000011.wav`;
    await env.MEDIA.put(directKey, wav);
    production = await result(
      await call(`${path}/assets/audio?version=${production.version}`, 'DELETE', undefined),
    );
    production = await result(
      await call(`${path}/assets/audio/bind`, 'POST', { version: production.version, key: directKey }),
    );
    expect(production.assets.audio?.key).toBe(directKey);
    expect(
      (
        await call(`${path}/assets/audio/bind`, 'POST', {
          version: production.version,
          key: `productions/${production.id}/audio-99-00000000-0000-4000-8000-000000000012.wav`,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(`${path}/assets/audio/bind`, 'POST', {
          version: production.version,
          key: 'uploads/not-a-uuid.wav',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`${path}/assets/audio/bind`, 'POST', {
          version: production.version,
          key: 'uploads/00000000-0000-4000-8000-000000000099.wav',
        })
      ).status,
    ).toBe(404);
  });

  it('cleans only the newly uploaded audio on a production conflict and keeps existing immutable keys', async () => {
    const production = await insert(readyFixture({ stage: 'production' }));
    const path = `/productions/${production.id}/assets/audio?version=1`;
    const conflictDb = new Proxy(env.DB, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) =>
            target.prepare(sql.startsWith('UPDATE productions SET') ? `${sql} AND version = -1` : sql);
        return Reflect.get(target, key, receiver);
      },
    });
    const before = (await env.MEDIA.list()).objects.length;
    expect((await call(path, 'PUT', wav, fullAgent, { ...env, DB: conflictDb })).status).toBe(409);
    expect((await env.MEDIA.list()).objects).toHaveLength(before);
    const fixedId = '00000000-0000-4000-8000-000000000000';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(fixedId);
    const key = `productions/${production.id}/audio-1-${fixedId}.wav`;
    await env.MEDIA.put(key, wav);
    expect((await call(path, 'PUT', wav)).status).toBe(400);
    expect(await env.MEDIA.head(key)).not.toBeNull();
  });
});
