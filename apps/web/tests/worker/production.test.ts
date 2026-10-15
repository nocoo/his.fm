import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Actor, Production } from '../../src/shared/production';
import { authenticateAgent, routeAgentTokens } from '../../worker/agent-tokens';
import { HttpError, json } from '../../worker/http';
import { publishProduction, routeProductions } from '../../worker/production';
import { readBytes, readJson } from '../../worker/production-body';
import { getProduction, saveProduction, updateProduction } from '../../worker/production-store';
import { agent, brief, fixture, fullAgent, human, readyFixture } from './production-fixture';

const origin = 'https://hisfm.dev.hexly.ai';
const assetAgent: Actor = { ...agent, scopes: [...(agent.scopes ?? []), 'storage:write'] };
let miniflare: Miniflare;
let env: Env;
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function request(path: string, method = 'GET', data?: unknown) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function call(path: string, method = 'GET', data?: unknown, actor: Actor = agent) {
  try {
    return (
      (await routeProductions(request(path, method, data), env, path, actor)) ??
      json({ error: 'Not found' }, 404)
    );
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }
}
async function create() {
  const response = await call('/productions', 'POST', brief);
  expect(response.status).toBe(201);
  return ((await response.json()) as { production: Production }).production;
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
async function tokenCall(path: string, method = 'GET', data?: unknown) {
  try {
    return await routeAgentTokens(request(path, method, data), env, path, human);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }
}
async function cover(production: Production, bytes = png, mime = 'image/png', version = production.version) {
  const path = `/productions/${production.id}/assets/cover`;
  const upload = new Request(`${origin}${path}?version=${version}`, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: bytes,
  });
  try {
    const response = await routeProductions(upload, env, path, assetAgent);
    if (!response) throw new Error('Missing upload route');
    return response;
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }
}

beforeAll(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'hisfm-production-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("test")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'production-test' },
            MEDIA: { type: 'r2', name: 'production-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await miniflare.getBindings<Env>();
  for (const file of [
    '0001_episodes.sql',
    '0003_production.sql',
    '0005_channel.sql',
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
    ['DELETE FROM productions', 'DELETE FROM episodes', 'DELETE FROM agent_tokens'].map((sql) =>
      env.DB.prepare(sql),
    ),
  );
});
afterAll(async () => {
  await miniflare?.dispose();
});

describe('production API and optimistic updates', () => {
  it('creates and lists private drafts, preserves sources while scripting, and records feedback', async () => {
    let production = await create();
    expect(production.events[0]).toMatchObject({ actor: agent, action: 'create' });
    expect(await (await call('/productions')).json()).toEqual({ productions: [production] });
    expect(await (await call(`/productions/${production.id}`)).json()).toMatchObject({
      production,
      categoryProfile: { id: production.category },
    });
    const path = `/productions/${production.id}`;
    let response = await call(path, 'PUT', { version: production.version, intent: '从今晚的饭桌开始。' });
    production = ((await response.json()) as { production: Production }).production;
    expect(production.intent).toBe('从今晚的饭桌开始。');
    for (const [action, actor] of [
      ['submit_brief', agent],
      ['revise_brief', human],
      ['submit_brief', agent],
      ['approve_brief', human],
    ] as const) {
      response = await call(
        `${path}/actions`,
        'POST',
        { version: production.version, action, feedback: '请讲一个具体场景' },
        actor,
      );
      expect(response.status).toBe(200);
      production = ((await response.json()) as { production: Production }).production;
    }
    expect(production.stage).toBe('scripting');
    response = await call(path, 'PUT', { version: production.version, transcript: '今晚先把电脑合上。' });
    expect(response.status).toBe(200);
    production = ((await response.json()) as { production: Production }).production;
    expect(production.sources).toEqual(brief.sources);
    expect(production.category).toBe('life');
    expect(production.scriptVersion).toBe(1);
    expect((await call(path, 'PUT', { version: production.version, title: '绕过确认改标题' })).status).toBe(
      409,
    );
    const prompt = (await (await call(`${path}/prompts`)).json()) as { script: string };
    expect(prompt.script).toContain('请讲一个具体场景');
  });

  it('requires the current version for edits and deletion and rejects unknown fields', async () => {
    const production = await create();
    const path = `/productions/${production.id}`;
    expect((await call(path, 'PUT', { version: 88, title: '变化' })).status).toBe(409);
    expect(
      (await call(path, 'PUT', { version: 1, assets: { cover: { url: 'https://evil.example' } } })).status,
    ).toBe(400);
    expect((await call(path, 'PUT', { version: 1, transcript: '不能跳过选题确认' })).status).toBe(409);
    expect((await call(path, 'PUT', { version: 1, id: 'replacement' })).status).toBe(400);
    for (const query of ['', '?version=0', '?version=-1', '?version=1.2', '?version=999999999999999999999']) {
      const req = request(`${path}${query}`, 'DELETE');
      await expect(routeProductions(req, env, path, fullAgent)).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      routeProductions(request(`${path}?version=2`, 'DELETE'), env, path, fullAgent),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await routeProductions(request(`${path}?version=1`, 'DELETE'), env, path, fullAgent))?.status,
    ).toBe(204);
    expect((await call(path)).status).toBe(404);
  });

  it('atomically saves and completes a stage without saving failed completion', async () => {
    const original = await create();
    const path = `/productions/${original.id}`;
    const invalid = await call(
      `${path}/actions`,
      'POST',
      { version: 1, action: 'approve_brief', changes: { intent: '' } },
      human,
    );
    expect(invalid.status).toBe(400);
    expect((await getProduction(env.DB, original.id)).intent).toBe(original.intent);
    expect(
      (
        await call(
          `${path}/actions`,
          'POST',
          { version: 1, action: 'submit_brief', changes: { intent: 'Agent inline write' } },
          { ...agent, scopes: ['productions:submit'] },
        )
      ).status,
    ).toBe(403);
    const response = await call(
      `${path}/actions`,
      'POST',
      { version: 1, action: 'approve_brief', changes: { intent: '已确定的新主题' } },
      human,
    );
    expect(response.status).toBe(200);
    const next = ((await response.json()) as { production: Production }).production;
    expect(next).toMatchObject({ version: 2, stage: 'scripting', intent: '已确定的新主题' });
  });

  it('lets the owner revise any stage without discarding material or granting agents approval', async () => {
    const original = await insert(readyFixture());
    const path = `/productions/${original.id}`;
    const changed = await call(path, 'PUT', { version: 1, transcript: '新的完整文稿' }, human);
    expect(changed.status).toBe(200);
    const next = ((await changed.json()) as { production: Production }).production;
    expect(next).toMatchObject({
      stage: 'scripting',
      transcript: '新的完整文稿',
      description: original.description,
      assets: original.assets,
      approvals: { brief: original.approvals.brief, script: null, final: null },
      scriptVersion: 2,
    });
    expect(
      (await call(`${path}/actions`, 'POST', { version: next.version, action: 'approve_script' }, agent))
        .status,
    ).toBe(403);
    const completed = await call(
      `${path}/actions`,
      'POST',
      { version: next.version, action: 'approve_script' },
      human,
    );
    expect(completed.status).toBe(200);
    expect(((await completed.json()) as { production: Production }).production.stage).toBe('production');
  });

  it('locks review and ready records and permits production metadata only in production', async () => {
    let production = await insert(readyFixture());
    const path = `/productions/${production.id}`;
    expect((await call(path, 'PUT', { version: 1, summary: '偷偷改稿' })).status).toBe(409);
    expect(
      (
        await call(
          `${path}/actions`,
          'POST',
          { version: 1, action: 'reopen_assets', feedback: '改简介' },
          agent,
        )
      ).status,
    ).toBe(403);
    let response = await call(
      `${path}/actions`,
      'POST',
      { version: 1, action: 'reopen_assets', feedback: '改简介' },
      human,
    );
    production = ((await response.json()) as { production: Production }).production;
    response = await call(path, 'PUT', {
      version: production.version,
      summary: '新的具体摘要',
      description: '来源与内容',
      category: 'life',
      tags: ['日常'],
    });
    expect(response.status).toBe(200);
    production = ((await response.json()) as { production: Production }).production;
    expect(production.summary).toBe('新的具体摘要');
    expect(
      (await call(path, 'PUT', { version: production.version, transcript: '不能直接改稿' })).status,
    ).toBe(409);
    expect((await call('/productions', 'PATCH')).status).toBe(405);
    expect((await call(path, 'PATCH')).status).toBe(405);
    expect((await call(`${path}/actions`, 'GET')).status).toBe(405);
    expect((await call('/unrelated')).status).toBe(404);
  });

  it('performs compare-and-swap and retries background updates without losing parallel edits', async () => {
    const original = await insert(fixture());
    const changed = await saveProduction(env.DB, { ...original, description: '一条新简介' }, 1);
    await expect(saveProduction(env.DB, original, 1)).rejects.toMatchObject({ status: 409 });
    const [first, second] = await Promise.all([
      updateProduction(env.DB, original.id, agent, 'cover_ready', (current) => ({
        ...current,
        tags: [...current.tags, '封面'],
      })),
      updateProduction(env.DB, original.id, agent, 'audio_ready', (current) => ({
        ...current,
        tags: [...current.tags, '音频'],
      })),
    ]);
    const latest = await getProduction(env.DB, original.id);
    expect(latest.tags).toEqual(expect.arrayContaining(['封面', '音频']));
    expect(latest.description).toBe(changed.description);
    expect(latest.version).toBe(Math.max(first.version, second.version));
    expect(latest.events).toHaveLength(2);
    await expect(
      updateProduction(env.DB, original.id, agent, 'invalid', (current) => ({ ...current, id: 'other' })),
    ).rejects.toMatchObject({ status: 409 });
    const conflictDb = new Proxy(env.DB, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) =>
            target.prepare(sql.startsWith('UPDATE productions SET') ? `${sql} AND version = -1` : sql);
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(
      updateProduction(conflictDb, original.id, agent, 'racing', (current) => current),
    ).rejects.toThrow('正在更新');
    await expect(
      updateProduction(conflictDb, original.id, agent, 'racing', (current) => current, {
        expectedVersion: latest.version,
      }),
    ).rejects.toThrow('已更新');
    const failedDb = new Proxy(env.DB, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) => {
            if (sql.startsWith('UPDATE productions SET')) throw new Error('storage unavailable');
            return target.prepare(sql);
          };
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(
      updateProduction(failedDb, original.id, agent, 'edit', (current) => current),
    ).rejects.toThrow('storage unavailable');
  });
});

describe('immutable raster cover uploads', () => {
  it('validates raster bytes, stores immutable local R2 assets and increments version', async () => {
    let production = await insert(readyFixture({ stage: 'production' }));
    const response = await cover(production);
    expect(response.status).toBe(200);
    production = ((await response.json()) as { production: Production }).production;
    expect(production.assets.cover).toMatchObject({
      mimeType: 'image/png',
      size: png.length,
      scriptVersion: 1,
    });
    expect(production.assets.cover?.url).toMatch(/^\/media\/productions\//);
    const object = await env.MEDIA.get(production.assets.cover?.key ?? '');
    expect(object?.httpMetadata?.cacheControl).toContain('immutable');
    if (!object) throw new Error('Missing uploaded cover');
    expect(new Uint8Array(await object.arrayBuffer())).toEqual(png);
    const webp = Uint8Array.from(
      readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
    );
    const second = await cover(production, webp, 'image/webp');
    expect(second.status).toBe(200);
    const next = ((await second.json()) as { production: Production }).production;
    expect(next.assets.cover?.key).not.toBe(production.assets.cover?.key);
    expect(next.assets.audio).toEqual(production.assets.audio);
  });

  it('recognizes JPEG magic, detects malformed raster signatures and prevents key reuse', async () => {
    let production = await insert(readyFixture({ stage: 'production' }));
    const jpeg = new Uint8Array(32);
    jpeg.set([255, 216, 255, 224]);
    jpeg.set([255, 217], 30);
    const response = await cover(production, jpeg, 'image/jpeg');
    expect(response.status).toBe(200);
    production = ((await response.json()) as { production: Production }).production;
    for (const index of [1, 4, 5, 6, 7, 12, png.length - 8]) {
      const broken = png.slice();
      broken[index] = 0;
      expect((await cover(production, broken)).status).toBe(415);
    }
    for (const index of [1, 2, 30, 31]) {
      const broken = jpeg.slice();
      broken[index] = 0;
      expect((await cover(production, broken, 'image/jpeg')).status).toBe(415);
    }
    const webp = Uint8Array.from(
      readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)),
    );
    for (const index of [4, 8, 12]) {
      const broken = webp.slice();
      broken[index] = 0;
      expect((await cover(production, broken, 'image/webp')).status).toBe(415);
    }
    const fixedId = '00000000-0000-4000-8000-000000000000';
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(fixedId);
    try {
      await env.MEDIA.put(`productions/${production.id}/cover-1-${fixedId}.png`, png);
      expect((await cover(production)).status).toBe(409);
    } finally {
      spy.mockRestore();
    }
  });

  it('removes a just-uploaded object when the database version changes', async () => {
    const production = await insert(readyFixture({ stage: 'production' }));
    const before = await env.MEDIA.list();
    const conflictingDb = new Proxy(env.DB, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (sql: string) =>
            target.prepare(sql.startsWith('UPDATE productions SET') ? `${sql} AND version = -1` : sql);
        return Reflect.get(target, key, receiver);
      },
    });
    const path = `/productions/${production.id}/assets/cover`;
    const upload = new Request(`${origin}${path}?version=1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });
    await expect(
      routeProductions(upload, { ...env, DB: conflictingDb }, path, assetAgent),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect((await env.MEDIA.list()).objects).toHaveLength(before.objects.length);
    expect((await getProduction(env.DB, production.id)).assets.cover).toEqual(production.assets.cover);
    const missingType = new Request(`${origin}${path}?version=1`, { method: 'PUT', body: png });
    await expect(routeProductions(missingType, env, path, assetAgent)).rejects.toMatchObject({ status: 415 });
  });

  it('rejects stale, wrongly typed, truncated and oversized uploads', async () => {
    const production = await insert(readyFixture({ stage: 'production' }));
    expect((await cover(production, png, 'image/png', 9)).status).toBe(409);
    expect((await cover(production, png, 'image/jpeg')).status).toBe(415);
    expect(
      (await cover(production, new TextEncoder().encode('<svg>image</svg>'), 'image/svg+xml')).status,
    ).toBe(415);
    expect((await cover(production, png.slice(0, 30), 'image/png')).status).toBe(415);
    const path = `/productions/${production.id}/assets/cover`;
    const oversized = new Request(`${origin}${path}?version=1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(9 * 1024 * 1024) },
      body: png,
    });
    await expect(routeProductions(oversized, env, path, assetAgent)).rejects.toMatchObject({ status: 413 });
    await saveProduction(env.DB, { ...production, stage: 'ready' }, 1);
    expect((await cover({ ...production, version: 2 })).status).toBe(409);
  });
});

describe('scope-authorized publication snapshots', () => {
  const publication = {
    version: 1,
    platform: 'wechat' as const,
    url: 'https://mp.weixin.qq.com/s/test',
    publishedAt: '2026-09-24T00:00:00.000Z',
  };
  it('publishes to his.fm without an external URL and links the production snapshot', async () => {
    const production = await insert(readyFixture());
    const path = `/productions/${production.id}/publications`;
    const response = await call(
      path,
      'POST',
      { version: 1, platform: 'site', publishedAt: '2026-09-24T00:00:00.000Z' },
      human,
    );
    expect(response.status).toBe(200);
    const published = ((await response.json()) as { production: Production }).production;
    expect(published.publications).toHaveLength(1);
    expect(published.publications[0]).toMatchObject({
      platform: 'site',
      url: '',
      confirmedBy: human.name,
    });
    const snapshot = await env.DB.prepare('SELECT * FROM episodes WHERE source_production_id = ?')
      .bind(production.id)
      .first();
    expect(snapshot).toMatchObject({ id: production.id, status: 'published' });
  });

  it('publishes atomically only after final approval and preserves history across platforms', async () => {
    let production = await insert(readyFixture());
    const path = `/productions/${production.id}`;
    expect((await call(`${path}/publications`, 'POST', publication, agent)).status).toBe(403);
    let response = await call(`${path}/publications`, 'POST', publication, human);
    expect(response.status).toBe(200);
    production = ((await response.json()) as { production: Production }).production;
    const snapshot = await env.DB.prepare('SELECT * FROM episodes WHERE source_production_id = ?')
      .bind(production.id)
      .first();
    expect(snapshot).toMatchObject({
      id: production.id,
      title: production.title,
      transcript: production.transcript,
      status: 'published',
      audio_url: production.assets.audio?.url,
    });
    response = await call(
      `${path}/publications`,
      'POST',
      {
        ...publication,
        version: production.version,
        platform: 'xiaoyuzhou',
        url: 'https://www.xiaoyuzhoufm.com/episode/test',
      },
      human,
    );
    expect(response.status).toBe(200);
    production = ((await response.json()) as { production: Production }).production;
    expect(production.publications).toHaveLength(2);
    expect(production.publications[0]).toMatchObject({ confirmedBy: human.name, version: 1 });
    await expect(
      routeProductions(request(`${path}?version=${production.version}`, 'DELETE'), env, path, human),
    ).rejects.toMatchObject({ status: 409 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM episodes').first<{ n: number }>())?.n).toBe(1);
    const reopened = await call(
      `${path}/actions`,
      'POST',
      { version: production.version, action: 'reopen_script', feedback: '修正研究范围' },
      human,
    );
    expect(reopened.status).toBe(200);
    expect(
      (
        await env.DB.prepare('SELECT transcript FROM episodes WHERE id = ?')
          .bind(production.id)
          .first<{ transcript: string }>()
      )?.transcript,
    ).toBe(production.transcript);
  });

  it('rejects mismatched platforms, future timestamps, missing approval and stale publications', async () => {
    const production = await insert(readyFixture());
    const path = `/productions/${production.id}/publications`;
    for (const url of [
      'https://example.com/post',
      'https://mp.weixin.qq.com.evil.example/post',
      'https://mp.weixin.qq.com@evil.example/post',
    ]) {
      expect((await call(path, 'POST', { ...publication, url }, human)).status).toBe(400);
    }
    expect(
      (await call(path, 'POST', { ...publication, publishedAt: '2999-01-01T00:00:00.000Z' }, human)).status,
    ).toBe(400);
    await expect(
      publishProduction(
        env.DB,
        { ...production, approvals: { ...production.approvals, final: null } },
        publication,
        human,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await saveProduction(
      env.DB,
      { ...production, stage: 'scripting', approvals: { ...production.approvals, final: null } },
      1,
    );
    await expect(publishProduction(env.DB, production, publication, human)).rejects.toMatchObject({
      status: 409,
    });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM episodes').first<{ n: number }>())?.n).toBe(0);
    expect((await getProduction(env.DB, production.id)).publications).toHaveLength(0);
  });

  it('rolls back the publication record on conflicting public slug or identity', async () => {
    const first = await insert(readyFixture());
    await publishProduction(env.DB, first, publication, human);
    const duplicate = await insert(readyFixture({ id: 'duplicate-id' }));
    await expect(publishProduction(env.DB, duplicate, publication, human)).rejects.toMatchObject({
      status: 409,
    });
    expect((await getProduction(env.DB, duplicate.id)).version).toBe(1);
    expect((await getProduction(env.DB, duplicate.id)).publications).toHaveLength(0);
    await env.DB.prepare('DELETE FROM episodes').run();
    await env.DB.prepare(
      "INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, status, featured, created_at, updated_at) VALUES (?, 'unrelated-manual', 1, 'Manual', 'Summary', '', '', '/images/episode-01.webp', 'work', '[]', 0, 'draft', 0, '', '')",
    )
      .bind(duplicate.id)
      .run();
    await expect(publishProduction(env.DB, duplicate, publication, human)).rejects.toMatchObject({
      status: 409,
    });
    expect((await getProduction(env.DB, duplicate.id)).version).toBe(1);
    expect(
      (
        await env.DB.prepare('SELECT title FROM episodes WHERE id = ?')
          .bind(duplicate.id)
          .first<{ title: string }>()
      )?.title,
    ).toBe('Manual');
  });
});

describe('revocable expiring agent tokens', () => {
  it('returns plaintext once, stores only a hash and tracks use before revocation', async () => {
    const response = await tokenCall('/admin/api/agent-tokens', 'POST', {
      name: 'Hermes',
      expiresInDays: 30,
      scopes: ['productions:read'],
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { token: string; record: { id: string } };
    expect(created.token).toMatch(/^hisfm_[a-f0-9]{64}$/);
    const stored = await env.DB.prepare('SELECT * FROM agent_tokens').first<{ token_hash: string }>();
    expect(stored?.token_hash).toHaveLength(64);
    expect(JSON.stringify(stored)).not.toContain(created.token);
    const authorized = new Request(`${origin}/api/agent/productions`, {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(await authenticateAgent(authorized, env)).toMatchObject({
      kind: 'agent',
      name: `Hermes (${created.record.id})`,
      tokenId: created.record.id,
      scopes: ['productions:read'],
      expiresAt: expect.any(Number),
    });
    const list = (await (await tokenCall('/admin/api/agent-tokens')).json()) as {
      tokens: { lastUsedAt: string }[];
    };
    expect(list.tokens[0].lastUsedAt).toBeTruthy();
    expect(JSON.stringify(list)).not.toContain(created.token);
    expect(JSON.stringify(list)).not.toContain('token_hash');
    expect((await tokenCall(`/admin/api/agent-tokens/${created.record.id}`, 'DELETE')).status).toBe(204);
    await expect(authenticateAgent(authorized, env)).rejects.toMatchObject({ status: 401 });
    expect((await tokenCall(`/admin/api/agent-tokens/${created.record.id}`, 'DELETE')).status).toBe(204);
  });

  it('rejects expired, absent and forged credentials and invalid token management', async () => {
    const response = await tokenCall('/admin/api/agent-tokens', 'POST', {
      name: 'Hermes',
      expiresInDays: 1,
      scopes: ['productions:read'],
    });
    const created = (await response.json()) as { token: string };
    await env.DB.prepare("UPDATE agent_tokens SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    for (const header of [
      '',
      'Bearer invalid',
      `Bearer hisfm_${'f'.repeat(64)}`,
      `Bearer ${created.token}`,
    ]) {
      await expect(
        authenticateAgent(
          new Request(`${origin}/api/agent/productions`, { headers: { Authorization: header } }),
          env,
        ),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(
      (await tokenCall('/admin/api/agent-tokens', 'POST', { name: '', expiresInDays: 366 })).status,
    ).toBe(400);
    expect((await tokenCall('/admin/api/agent-tokens', 'PUT')).status).toBe(405);
    expect((await tokenCall('/admin/api/agent-tokens/missing', 'GET')).status).toBe(405);
    expect((await tokenCall('/admin/api/agent-tokens/missing', 'DELETE')).status).toBe(404);
    expect((await tokenCall('/other')).status).toBe(404);
    await expect(
      routeAgentTokens(
        new Request(`${origin}/admin/api/agent-tokens`, { method: 'POST' }),
        env,
        '/admin/api/agent-tokens',
        { kind: 'agent', name: 'Unscoped' },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('bounded request parsing', () => {
  it('rejects invalid media types, malformed JSON, missing bodies and streamed overflow', async () => {
    await expect(
      readJson(new Request(origin, { method: 'POST', body: '{}' }), z.object({})),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      readJson(
        new Request(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }),
        z.object({}),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(readBytes(new Request(origin, { method: 'POST' }), 10)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      readBytes(new Request(origin, { method: 'POST', body: 'too long' }), 2),
    ).rejects.toMatchObject({ status: 413 });
    expect(
      await readJson(
        new Request(origin, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: '{"title":"ok"}',
        }),
        z.object({ title: z.string() }),
      ),
    ).toEqual({ title: 'ok' });
  });
});
