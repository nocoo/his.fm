import { readdirSync, readFileSync } from 'node:fs';
import type { Principal, Scope } from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTokenRecord, Production } from '../../src/shared/production';
import worker from '../../worker';
import { routeAgentTokens } from '../../worker/agent-tokens';
import { brief } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const origin = 'https://hisfm.dev.hexly.ai';
let mf: Miniflare;
let env: Env;
let cookie = '';
type Secret = { token: string; record: AgentTokenRecord };
function call(path: string, secret?: Secret, method = 'GET', data?: unknown) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (secret) headers.set('Authorization', `Bearer ${secret.token}`);
  if (path.startsWith('/admin/')) {
    headers.set('Cookie', cookie);
    headers.set('Origin', origin);
  }
  return worker.fetch(
    new Request(`${origin}${path}`, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
    env,
  );
}

const api = (path: string, secret: Secret, method = 'GET', data?: unknown) =>
  call(`/api/agent${path}`, secret, method, data);

async function issue(scopes: Scope[], expiresInDays = 7, issuer?: Secret) {
  const response = issuer
    ? await api('/agent-tokens', issuer, 'POST', { name: 'Delegated fixture', scopes, expiresInDays })
    : await call('/admin/api/agent-tokens', undefined, 'POST', {
        name: 'Scoped fixture',
        scopes,
        expiresInDays,
      });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as Secret;
}

async function principal(secret: Secret): Promise<Principal> {
  return ((await (await api('/me', secret)).json()) as { actor: Principal }).actor;
}

async function createProduction() {
  const response = await call('/admin/api/productions', undefined, 'POST', brief);
  expect(response.status).toBe(201);
  return ((await response.json()) as { production: Production }).production;
}

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'scoped-api-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'scoped-api' },
            MEDIA: { type: 'r2', name: 'scoped-api' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await mf.getBindings<Env>();
  for (const name of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(`migrations/${name}`, 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => env.DB.prepare(sql)),
    );
  }
});

beforeEach(async () => {
  await env.DB.batch(
    [
      'agent_tokens',
      'productions',
      'episodes',
      'episode_number_claims',
      'local_sessions',
      'channel_profile',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  await env.DB.prepare("UPDATE categories SET name='Life', prompt='' WHERE id='life'").run();
  const login = await call('/admin/api/dev-login', undefined, 'POST');
  expect(login.status).toBe(200);
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
});

afterAll(() => mf.dispose());

describe('token authority', () => {
  it('requires explicit finite nonempty grants and bounded expiry at issuance', async () => {
    for (const invalid of [
      {},
      { scopes: [] },
      { scopes: ['unknown:grant'] },
      { scopes: ['episodes:read', 'episodes:read'] },
      { scopes: ['episodes:read'], expiresInDays: 0 },
      { scopes: ['episodes:read'], expiresInDays: 366 },
      { scopes: ['episodes:read'], expiresInDays: 1.5 },
    ]) {
      expect(
        (
          await call('/admin/api/agent-tokens', undefined, 'POST', {
            name: 'Invalid',
            expiresInDays: 1,
            ...invalid,
          })
        ).status,
      ).toBe(400);
    }
    const secret = await issue(['episodes:read'], 365);
    const actor = await principal(secret);
    expect(actor).toMatchObject({
      kind: 'agent',
      tokenId: secret.record.id,
      scopes: ['episodes:read'],
      expiresAt: Date.parse(secret.record.expiresAt),
    });
    const reader = await issue(['tokens:read']);
    const list = await api('/agent-tokens', reader);
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).toContain(secret.record.id);
    expect(text).not.toContain(secret.token);
    expect(text).not.toContain('token_hash');
    expect((await api('/agent-tokens', secret)).status).toBe(403);
  });

  it('limits delegation to the issuer grant and expiry ceilings', async () => {
    const parent = await issue(['tokens:issue', 'tokens:revoke', 'episodes:read'], 10);
    const child = await issue(['tokens:issue', 'episodes:read'], 5, parent);
    const leaf = await issue(['episodes:read'], 1, child);
    expect(
      await env.DB.prepare('SELECT parent_id FROM agent_tokens WHERE id=?').bind(leaf.record.id).first(),
    ).toEqual({ parent_id: child.record.id });
    for (const [issuer, scopes, expiresInDays] of [
      [parent, ['episodes:write'], 1],
      [parent, ['episodes:read'], 11],
      [child, ['tokens:revoke'], 1],
      [leaf, ['episodes:read'], 1],
    ] as [Secret, Scope[], number][]) {
      expect(
        (await api('/agent-tokens', issuer, 'POST', { name: 'Escalation', scopes, expiresInDays })).status,
      ).toBe(403);
    }
    expect((await api(`/agent-tokens/${parent.record.id}/revoke`, leaf, 'POST')).status).toBe(403);
    const revoker = await issue(['tokens:revoke']);
    expect((await api(`/agent-tokens/${leaf.record.id}/revoke`, revoker, 'POST')).status).toBe(403);
    expect((await api(`/agent-tokens/${leaf.record.id}/revoke`, parent, 'POST')).status).toBe(204);
    expect((await api('/me', leaf)).status).toBe(401);
    expect((await api('/me', child)).status).toBe(200);
  });

  it('revokes every descendant without revoking unrelated tokens', async () => {
    const parent = await issue(['tokens:issue', 'episodes:read'], 10);
    const child = await issue(['tokens:issue', 'episodes:read'], 5, parent);
    const grandchild = await issue(['episodes:read'], 1, child);
    const independent = await issue(['episodes:read']);
    expect((await call(`/admin/api/agent-tokens/${parent.record.id}/revoke`, undefined, 'POST')).status).toBe(
      204,
    );
    for (const secret of [parent, child, grandchild]) {
      expect((await api('/me', secret)).status).toBe(401);
      expect(
        await env.DB.prepare('SELECT revoked_at FROM agent_tokens WHERE id=?').bind(secret.record.id).first(),
      ).toEqual({ revoked_at: expect.any(String) });
    }
    expect((await api('/me', independent)).status).toBe(200);
  });

  it('requires revocation before deletion, including expired tokens', async () => {
    const secret = await issue(['episodes:read']);
    const path = `/admin/api/agent-tokens/${secret.record.id}`;
    expect((await call(path, undefined, 'DELETE')).status).toBe(409);
    expect((await api('/me', secret)).status).toBe(200);
    await env.DB.prepare('UPDATE agent_tokens SET expires_at=? WHERE id=?')
      .bind('2000-01-01T00:00:00.000Z', secret.record.id)
      .run();
    expect((await call(path, undefined, 'DELETE')).status).toBe(409);
    expect((await call(`${path}/revoke`, undefined, 'DELETE')).status).toBe(405);
    expect((await call(`${path}/revoke`, undefined, 'POST')).status).toBe(204);
    expect((await call(path, undefined, 'DELETE')).status).toBe(204);
    const first = await env.DB.prepare('SELECT deleted_at FROM agent_tokens WHERE id=?')
      .bind(secret.record.id)
      .first();
    expect(first).toEqual({ deleted_at: expect.any(String) });
    expect((await call(path, undefined, 'DELETE')).status).toBe(204);
    expect(
      await env.DB.prepare('SELECT deleted_at FROM agent_tokens WHERE id=?').bind(secret.record.id).first(),
    ).toEqual(first);
    expect((await api('/me', secret)).status).toBe(401);
  });

  it('separates token deletion from revocation and checks target grant ceilings', async () => {
    const secret = await issue(['episodes:read']);
    const revoker = await issue(['tokens:revoke', 'episodes:read']);
    const narrowDeleter = await issue(['tokens:delete']);
    const deleter = await issue(['tokens:delete', 'tokens:read', 'episodes:read']);
    const path = `/agent-tokens/${secret.record.id}`;
    expect((await api(`${path}/revoke`, deleter, 'POST')).status).toBe(403);
    expect((await api(`${path}/revoke`, revoker, 'POST')).status).toBe(204);
    expect((await api(path, revoker, 'DELETE')).status).toBe(403);
    expect((await api(path, narrowDeleter, 'DELETE')).status).toBe(403);
    expect((await api(path, deleter, 'DELETE')).status).toBe(204);
    expect((await api('/agent-tokens/missing', deleter, 'DELETE')).status).toBe(404);
    const list = (await (await api('/agent-tokens', deleter)).json()) as { tokens: AgentTokenRecord[] };
    expect(list.tokens.map((record) => record.id)).not.toContain(secret.record.id);
    expect(list.tokens.map((record) => record.id)).toContain(revoker.record.id);
  });

  it.each(['revoked', 'issue-grant', 'child-grant', 'expiry', 'deleted'])(
    'rechecks live issuer authority atomically after authentication: %s',
    async (change) => {
      const parent = await issue(['tokens:issue', 'episodes:read'], 10);
      const actor = await principal(parent);
      if (change === 'revoked')
        await call(`/admin/api/agent-tokens/${parent.record.id}/revoke`, undefined, 'POST');
      else if (change === 'deleted')
        await env.DB.prepare('DELETE FROM agent_tokens WHERE id=?').bind(parent.record.id).run();
      else if (change === 'expiry')
        await env.DB.prepare('UPDATE agent_tokens SET expires_at=? WHERE id=?')
          .bind(new Date(Date.now() + 3600000).toISOString(), parent.record.id)
          .run();
      else
        await env.DB.prepare('UPDATE agent_tokens SET scopes=? WHERE id=?')
          .bind(
            JSON.stringify([change === 'issue-grant' ? 'episodes:read' : 'tokens:issue']),
            parent.record.id,
          )
          .run();
      await expect(
        routeAgentTokens(
          new Request(`${origin}/api/agent/agent-tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Raced child', expiresInDays: 1, scopes: ['episodes:read'] }),
          }),
          env,
          '/agent-tokens',
          actor,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await env.DB.prepare('SELECT COUNT(*) AS n FROM agent_tokens WHERE parent_id=?')
          .bind(parent.record.id)
          .first('n'),
      ).toBe(0);
    },
  );

  it('never treats absent, expired or unscoped tokens as a human principal', async () => {
    for (const path of ['/api/agent/me', '/api/agent/productions', '/admin/api/episodes']) {
      const response = await worker.fetch(new Request(`${origin}${path}`), env);
      expect(response.status).toBe(401);
    }
    const secret = await issue(['episodes:read']);
    await env.DB.prepare("UPDATE agent_tokens SET scopes='[]' WHERE id=?").bind(secret.record.id).run();
    expect((await api('/me', secret)).status).toBe(401);
    await env.DB.prepare(
      "UPDATE agent_tokens SET scopes='[\"episodes:read\"]', expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(secret.record.id)
      .run();
    expect((await api('/me', secret)).status).toBe(401);
    await env.DB.prepare('UPDATE agent_tokens SET scopes=?, expires_at=? WHERE id=?')
      .bind(
        JSON.stringify(['episodes:read', 'unknown:grant']),
        new Date(Date.now() + 86400000).toISOString(),
        secret.record.id,
      )
      .run();
    expect((await api('/me', secret)).status).toBe(401);
  });
});

describe('grant-specific representations', () => {
  it('advertises only actions and editable fields authorized for the caller', async () => {
    const production = await createProduction();
    const reader = await issue(['productions:read']);
    const editor = await issue(['productions:read', 'productions:write', 'productions:submit']);
    const caps = await (await api('/capabilities', reader)).json();
    expect(caps).toMatchObject({ scopes: ['productions:read'], editableFields: {}, agentActions: [] });
    expect(await (await api(`/productions/${production.id}/capabilities`, reader)).json()).toMatchObject({
      editableFields: [],
      availableActions: [],
      canDelete: false,
      canUploadCover: false,
      canUploadAudio: false,
    });
    expect(await (await api(`/productions/${production.id}/capabilities`, editor)).json()).toMatchObject({
      editableFields: expect.arrayContaining(['intent']),
      availableActions: ['submit_brief'],
    });
    const submitted = await api(`/productions/${production.id}/actions`, editor, 'POST', {
      version: production.version,
      action: 'submit_brief',
    });
    expect(submitted.status).toBe(200);
    const review = ((await submitted.json()) as { production: Production }).production;
    expect(
      (
        await api(`/productions/${production.id}/actions`, editor, 'POST', {
          version: review.version,
          action: 'approve_brief',
        })
      ).status,
    ).toBe(403);
    const approver = await issue(['productions:read', 'productions:approve']);
    expect(await (await api(`/productions/${production.id}/capabilities`, approver)).json()).toMatchObject({
      availableActions: ['approve_brief'],
      editableFields: [],
    });
    const reopener = await issue(['productions:read', 'productions:reopen']);
    expect(await (await api(`/productions/${production.id}/capabilities`, reopener)).json()).toMatchObject({
      availableActions: ['revise_brief', 'reopen_brief'],
      editableFields: [],
    });
    const approved = await api(`/productions/${production.id}/actions`, approver, 'POST', {
      version: review.version,
      action: 'approve_brief',
    });
    expect(approved.status).toBe(200);
    expect(
      ((await approved.json()) as { production: Production }).production.events.at(-1)?.actor,
    ).toMatchObject({ kind: 'agent', tokenId: approver.record.id });
  });

  it('keeps private prompts out of metadata, unauthorized writes and every public projection', async () => {
    const secretPrompt = 'PRIVATE_SCOPED_PROMPT_SENTINEL';
    await env.DB.prepare("UPDATE categories SET prompt=? WHERE id='life'").bind(secretPrompt).run();
    const production = await createProduction();
    const metadata = await issue(['productions:read', 'categories:read', 'categories:write']);
    const promptReader = await issue(['productions:read', 'categories:read', 'prompts:read']);
    const category = (
      (await (await api('/categories/life', metadata)).json()) as { category: { version: number } }
    ).category;
    for (const path of ['/categories', '/categories/life', `/productions/${production.id}`]) {
      const response = await api(path, metadata);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(secretPrompt);
      expect(await (await api(path, promptReader)).text()).toContain(secretPrompt);
    }
    expect((await api('/channel', metadata)).status).toBe(403);
    expect((await api(`/productions/${production.id}/prompts`, metadata)).status).toBe(403);
    expect(await (await api(`/productions/${production.id}/prompts`, promptReader)).text()).toContain(
      secretPrompt,
    );
    expect(
      (
        await api('/categories/life', metadata, 'PUT', {
          version: category.version,
          prompt: 'Unauthorized replacement',
        })
      ).status,
    ).toBe(403);
    const changed = await api('/categories/life', metadata, 'PUT', {
      version: category.version,
      name: 'Renamed',
    });
    expect(changed.status).toBe(200);
    expect(await changed.text()).not.toContain(secretPrompt);
    expect(await env.DB.prepare("SELECT prompt FROM categories WHERE id='life'").first()).toEqual({
      prompt: secretPrompt,
    });
    for (const path of [
      '/api/agent',
      '/api/agent/openapi.json',
      '/api/agent/instructions',
      '/.well-known/api-catalog',
      '/llms.txt',
      '/api/categories',
      '/api/episodes',
    ]) {
      const response = await call(path);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(secretPrompt);
    }
  });

  it('returns only resource identity and version when a writer lacks read authority', async () => {
    const writer = await issue(['productions:write', 'productions:submit', 'episodes:write']);
    const created = await api('/productions', writer, 'POST', brief);
    expect(created.status).toBe(201);
    const result = (await created.json()) as { production: { id: string; version: number } };
    expect(result).toEqual({ production: { id: expect.any(String), version: 1 } });
    const updated = await api(`/productions/${result.production.id}`, writer, 'PUT', {
      version: 1,
      intent: 'Write without reading private context',
    });
    expect(await updated.json()).toEqual({ production: { id: result.production.id, version: 2 } });
    expect(
      await (
        await api(`/productions/${result.production.id}/actions`, writer, 'POST', {
          version: 2,
          action: 'submit_brief',
        })
      ).json(),
    ).toEqual({ production: { id: result.production.id, version: 3 } });
    expect((await api(`/productions/${result.production.id}`, writer)).status).toBe(403);
    const episodeInput = {
      slug: 'private-writer',
      episodeNumber: 9,
      title: 'Private write',
      summary: 'Summary',
      transcript: 'Private transcript',
      lead: '',
      researchNote: '',
      credits: '',
      body: '',
      topics: [],
      coverUrl: '/images/cover.webp',
      category: 'life',
      tags: [],
      durationSeconds: 0,
      audioUrl: null,
      status: 'draft',
      featured: false,
      publishedAt: null,
    };
    const episodeResponse = await api('/episodes', writer, 'POST', episodeInput);
    expect(episodeResponse.status).toBe(201);
    const { episode } = (await episodeResponse.json()) as { episode: { id: string; version: number } };
    expect(episode).toEqual({ id: expect.any(String), version: 1 });
    expect(
      await (
        await api(`/episodes/${episode.id}`, writer, 'PUT', {
          ...episodeInput,
          version: 1,
          title: 'Updated title',
        })
      ).json(),
    ).toEqual({ episode: { id: episode.id, version: 2 } });
    expect(
      await (await api(`/episodes/${episode.id}`, writer, 'PATCH', { version: 2, featured: true })).json(),
    ).toEqual({ episode: { id: episode.id, version: 3 } });
    expect((await api(`/episodes/${episode.id}`, writer)).status).toBe(403);
  });
});

it('lists invalid token metadata without granting authority and leaves its removal to the owner', async () => {
  const invalid = await issue(['episodes:read']);
  const malformed = await issue(['episodes:read']);
  const healthy = await issue(['episodes:read']);
  const empty = await issue(['episodes:read']);
  const invalidElement = await issue(['episodes:read']);
  const manager = await issue(['tokens:read', 'tokens:revoke', 'tokens:delete', 'episodes:read']);
  await env.DB.prepare('UPDATE agent_tokens SET scopes=? WHERE id=?')
    .bind(JSON.stringify(['episodes:read', 'unknown:grant']), invalid.record.id)
    .run();
  await env.DB.prepare('UPDATE agent_tokens SET scopes=? WHERE id=?')
    .bind(JSON.stringify({ unknown: true }), malformed.record.id)
    .run();
  await env.DB.prepare("UPDATE agent_tokens SET scopes='[]' WHERE id=?").bind(empty.record.id).run();
  await env.DB.prepare('UPDATE agent_tokens SET scopes=? WHERE id=?')
    .bind(JSON.stringify([{ toString: null }, null, true, 1]), invalidElement.record.id)
    .run();
  expect((await api('/me', invalid)).status).toBe(401);
  expect((await api('/me', invalidElement)).status).toBe(401);
  const response = await call('/admin/api/agent-tokens');
  expect(response.status).toBe(200);
  const { tokens } = (await response.json()) as { tokens: AgentTokenRecord[] };
  expect(tokens.find((token) => token.id === invalid.record.id)).toMatchObject({
    scopes: [],
    invalidScopes: ['episodes:read', 'unknown:grant'],
  });
  expect(tokens.find((token) => token.id === malformed.record.id)).toMatchObject({
    scopes: [],
    invalidScopes: ['{"unknown":true}'],
  });
  expect(tokens.find((token) => token.id === healthy.record.id)).toMatchObject({ scopes: ['episodes:read'] });
  expect(tokens.find((token) => token.id === empty.record.id)).toMatchObject({ scopes: [] });
  expect(tokens.find((token) => token.id === invalidElement.record.id)).toMatchObject({
    scopes: [],
    invalidScopes: ['{"toString":null}', 'null', 'true', '1'],
  });
  expect((await api('/agent-tokens', manager)).status).toBe(200);
  expect((await api(`/agent-tokens/${invalid.record.id}/revoke`, manager, 'POST')).status).toBe(403);
  expect((await call(`/admin/api/agent-tokens/${invalid.record.id}/revoke`, undefined, 'POST')).status).toBe(
    204,
  );
  expect((await api(`/agent-tokens/${invalid.record.id}`, manager, 'DELETE')).status).toBe(403);
  expect((await call(`/admin/api/agent-tokens/${invalid.record.id}`, undefined, 'DELETE')).status).toBe(204);
  expect((await api('/me', healthy)).status).toBe(200);
});
