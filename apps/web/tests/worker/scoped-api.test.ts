import { readdirSync, readFileSync } from 'node:fs';
import type { AgentCommand, Principal, Scope } from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTokenRecord, Production } from '../../src/shared/production';
import worker from '../../worker';
import { enqueue } from '../../worker/agent-runtime-store';
import { routeAgentTokens } from '../../worker/agent-tokens';
import { commandOrigin, commandPrincipal, currentPrincipal } from '../../worker/authorization';
import { json } from '../../worker/http';
import { brief } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const origin = 'https://hisfm.dev.hexly.ai';
let mf: Miniflare;
let env: Env;
let cookie = '';
type Secret = { token: string; record: AgentTokenRecord };
const submissionScopes: Scope[] = ['tasks:submit', 'tasks:manage', 'prompts:read'];
const taskScopes: Scope[] = [...submissionScopes, 'tasks:read', 'tasks:cancel'];
const task = (id: string) => ({ id, text: 'Inspect this task without external work.', context: null });
const hubFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  if (path === '/task') {
    const { input, principal } = (await request.json()) as {
      input: Omit<AgentCommand, 'createdAt' | 'principal'>;
      principal: Principal;
    };
    const saved = await enqueue(env.DB, input, principal);
    return json(saved, saved.inserted ? 201 : 200);
  }
  if (path === '/task-cancel') return json({ cancelled: (await request.json()) as { id: string } });
  return json({ ok: true });
});

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
  const response = await api('/me', secret);
  expect(response.status).toBe(200);
  return ((await response.json()) as { actor: Principal }).actor;
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
  env.AGENT_HUB = { getByName: () => ({ fetch: hubFetch }) } as unknown as DurableObjectNamespace;
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
      'agent_receipts',
      'agent_events',
      'agent_commands',
      'agent_station',
      'agent_tokens',
      'productions',
      'episodes',
      'local_sessions',
      'channel_profile',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  await env.DB.prepare("UPDATE categories SET name='Life', prompt='' WHERE id='life'").run();
  hubFetch.mockClear();
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
    expect(hubFetch.mock.calls.some(([request]) => String(request).endsWith('/prune'))).toBe(true);
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

  it('retains revoked delegation, station and task audit references after deleting a parent', async () => {
    const parent = await issue(['tokens:issue', 'runtime:connect', 'episodes:read', ...taskScopes], 10);
    const child = await issue(['episodes:read'], 1, parent);
    const actor = await principal(parent);
    await env.DB.prepare('INSERT INTO agent_station(id,token_id,station_id,version) VALUES(1,?,?,1)')
      .bind(parent.record.id, 'deleted-token-station')
      .run();
    expect((await api('/tasks', parent, 'POST', task('deletion-audit'))).status).toBe(201);
    const audit = await env.DB.prepare('SELECT data FROM agent_commands WHERE id=?')
      .bind('deletion-audit')
      .first();
    const path = `/admin/api/agent-tokens/${parent.record.id}`;
    expect((await call(`${path}/revoke`, undefined, 'POST')).status).toBe(204);
    expect((await call(path, undefined, 'DELETE')).status).toBe(204);
    const list = (await (await call('/admin/api/agent-tokens')).json()) as { tokens: AgentTokenRecord[] };
    expect(list.tokens.map((record) => record.id)).not.toContain(parent.record.id);
    expect(list.tokens.find((record) => record.id === child.record.id)?.revokedAt).toEqual(
      expect.any(String),
    );
    expect(
      await env.DB.prepare('SELECT parent_id FROM agent_tokens WHERE id=?').bind(child.record.id).first(),
    ).toEqual({ parent_id: parent.record.id });
    expect(await env.DB.prepare('SELECT token_id FROM agent_station').first()).toEqual({
      token_id: parent.record.id,
    });
    expect(
      await env.DB.prepare('SELECT data FROM agent_commands WHERE id=?').bind('deletion-audit').first(),
    ).toEqual(audit);
    for (const secret of [parent, child]) expect((await api('/me', secret)).status).toBe(401);
    await expect(currentPrincipal(env.DB, actor)).rejects.toMatchObject({ status: 403 });
    await expect(
      env.DB.prepare('UPDATE agent_tokens SET revoked_at=NULL WHERE id=?').bind(parent.record.id).run(),
    ).rejects.toThrow();
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
    await expect(
      enqueue(env.DB, task('missing-principal'), undefined as unknown as Principal),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      enqueue(env.DB, task('unscoped-principal'), { kind: 'agent', name: 'No authority' }),
    ).rejects.toMatchObject({ status: 403 });
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
      canGenerateAudio: false,
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
      showNotes: '',
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

describe('task authority and ownership', () => {
  it('assigns server-authenticated ownership, is idempotent and rejects supplied principals', async () => {
    const owner = await issue(taskScopes);
    const forged = await api('/tasks', owner, 'POST', {
      ...task('forged'),
      principal: { kind: 'human', name: 'Owner' },
    });
    expect(forged.status).toBe(400);
    expect(
      (await api('/tasks', owner, 'POST', { ...task('forged-time'), createdAt: '2000-01-01' })).status,
    ).toBe(400);
    const created = await api('/tasks', owner, 'POST', task('owned'));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      inserted: true,
      command: {
        id: 'owned',
        principal: { kind: 'agent', tokenId: owner.record.id, scopes: taskScopes },
        createdAt: expect.any(String),
      },
    });
    expect((await api('/tasks', owner, 'POST', task('owned'))).status).toBe(200);
    expect((await api('/tasks', owner, 'POST', { ...task('owned'), text: 'Different request' })).status).toBe(
      409,
    );
    const other = await issue(taskScopes);
    expect((await api('/tasks', other, 'POST', task('owned'))).status).toBe(409);
    const readOnly = await issue(['tasks:read']);
    expect((await api('/tasks', readOnly, 'POST', task('denied'))).status).toBe(403);
    expect((await api('/tasks/owned/cancel', readOnly, 'POST')).status).toBe(403);
    const submitOnly = await issue(['tasks:submit']);
    expect((await api('/tasks', submitOnly)).status).toBe(403);
    expect((await api('/tasks', submitOnly, 'POST', task('shared-history-denied'))).status).toBe(403);
  });

  it('isolates task listings, details, messages and cancellation per token unless manage is granted', async () => {
    const first = await issue(taskScopes);
    const second = await issue(taskScopes);
    await api('/tasks', first, 'POST', task('first'));
    await api('/tasks', second, 'POST', task('second'));
    await env.DB.prepare('UPDATE agent_tokens SET scopes=? WHERE id IN (?,?)')
      .bind(JSON.stringify(['tasks:read', 'tasks:cancel']), first.record.id, second.record.id)
      .run();
    for (const [id, commandId] of [
      ['reply-first', 'first'],
      ['reply-second', 'second'],
    ]) {
      const message = {
        id,
        commandId,
        text: `Private response ${commandId}`,
        role: 'assistant',
        createdAt: new Date().toISOString(),
      };
      await env.DB.prepare(
        "INSERT INTO agent_events(id,hash,type,data,created_at) VALUES (?,?,'message',?,?)",
      )
        .bind(id, id, JSON.stringify({ type: 'message', message }), Date.now())
        .run();
    }
    expect(await (await api('/tasks', first)).json()).toMatchObject({ tasks: [{ id: 'first' }] });
    expect(await (await api('/tasks/first', first)).json()).toMatchObject({
      task: { id: 'first' },
      messages: [{ id: 'reply-first' }],
    });
    const before = hubFetch.mock.calls.length;
    expect((await api('/tasks/second', first)).status).toBe(404);
    expect((await api('/tasks/second/cancel', first, 'POST')).status).toBe(404);
    expect(hubFetch.mock.calls).toHaveLength(before);
    expect((await api('/tasks/missing', first)).status).toBe(404);
    expect((await api('/tasks/first/cancel', first, 'POST')).status).toBe(200);
    const manager = await issue(['tasks:read', 'tasks:cancel', 'tasks:manage']);
    const managed = (await (await api('/tasks', manager)).json()) as { tasks: { id: string }[] };
    expect(managed.tasks.map(({ id }) => id).sort()).toEqual(['first', 'second']);
    expect((await api('/tasks/second', manager)).status).toBe(200);
    expect((await api('/tasks/second/cancel', manager, 'POST')).status).toBe(200);
    const manageOnly = await issue(['tasks:manage']);
    expect((await api('/tasks', manageOnly)).status).toBe(403);
    expect((await api('/tasks/second/cancel', manageOnly, 'POST')).status).toBe(403);
    for (const [path, method] of [
      ['/tasks', 'PUT'],
      ['/tasks/first', 'DELETE'],
      ['/tasks/first/cancel', 'GET'],
    ])
      expect((await api(path, first, method)).status).toBe(405);
  });

  it('requires production read authority for a referenced task context', async () => {
    const production = await createProduction();
    const submitter = await issue(['tasks:submit']);
    const context = {
      tabId: 'tab-scoped',
      pageEpoch: 1,
      seq: 1,
      route: `/admin/productions/${production.id}`,
      productionId: production.id,
      step: 'brief',
      sourceId: null,
      version: production.version,
      field: null,
      draft: null,
      selection: null,
      activity: 'viewing',
    };
    expect((await api('/tasks', submitter, 'POST', { ...task('context-denied'), context })).status).toBe(403);
    const reader = await issue([...submissionScopes, 'productions:read']);
    expect((await api('/tasks', reader, 'POST', { ...task('context-allowed'), context })).status).toBe(201);
  });

  it('intersects live executor and origin grants with the immutable submission ceiling', async () => {
    const originator = await issue([...submissionScopes, 'productions:read', 'productions:write']);
    const executor = await issue(['runtime:connect', 'productions:read', 'productions:approve']);
    await api('/tasks', originator, 'POST', task('ceiling'));
    const machine = await principal(executor);
    expect(await commandPrincipal(env.DB, 'ceiling', machine)).toMatchObject({
      kind: 'agent',
      tokenId: executor.record.id,
      scopes: ['productions:read'],
    });
    await env.DB.prepare('UPDATE agent_tokens SET scopes=? WHERE id=?')
      .bind(
        JSON.stringify([...submissionScopes, 'productions:read', 'productions:write', 'productions:approve']),
        originator.record.id,
      )
      .run();
    expect((await commandPrincipal(env.DB, 'ceiling', machine)).scopes).toEqual(['productions:read']);
    await env.DB.prepare('UPDATE agent_tokens SET scopes=? WHERE id=?')
      .bind(JSON.stringify(submissionScopes), originator.record.id)
      .run();
    expect((await commandPrincipal(env.DB, 'ceiling', machine)).scopes).toEqual([]);
    const origin = await commandOrigin(env.DB, 'ceiling');
    expect(origin.scopes).toEqual(submissionScopes);
    await env.DB.prepare("UPDATE agent_tokens SET revoked_at='now' WHERE id=?")
      .bind(executor.record.id)
      .run();
    await expect(commandPrincipal(env.DB, 'ceiling', machine)).rejects.toMatchObject({ status: 403 });
    await env.DB.prepare("UPDATE agent_tokens SET revoked_at='now' WHERE id=?")
      .bind(originator.record.id)
      .run();
    await expect(commandOrigin(env.DB, 'ceiling')).rejects.toMatchObject({ status: 403 });
  });

  it('enforces command ceilings on enrolled runtime reads and rejects untyped command mutations', async () => {
    const production = await createProduction();
    const originator = await issue([...submissionScopes, 'productions:read']);
    const executor = await issue(['runtime:connect', 'productions:read', 'productions:write']);
    await api('/tasks', originator, 'POST', task('runtime-read'));
    await env.DB.prepare('INSERT INTO agent_station(id,token_id,station_id,version) VALUES (1,?,?,1)')
      .bind(executor.record.id, 'scoped-station')
      .run();
    const runtimeRead = (path: string, station = 'scoped-station', method = 'GET') =>
      worker.fetch(
        new Request(`${origin}/api/agent${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${executor.token}`,
            'X-Hisfm-Command': 'runtime-read',
            'X-Hisfm-Station': station,
          },
        }),
        env,
      );
    const detail = await runtimeRead(`/productions/${production.id}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { categoryProfile: unknown }).categoryProfile).not.toHaveProperty(
      'prompt',
    );
    expect(await (await runtimeRead(`/productions/${production.id}/capabilities`)).json()).toMatchObject({
      editableFields: [],
      availableActions: [],
    });
    expect((await runtimeRead(`/productions/${production.id}/prompts`)).status).toBe(403);
    expect((await runtimeRead(`/productions/${production.id}`, 'other-station')).status).toBe(403);
    expect((await runtimeRead(`/productions/${production.id}`, 'scoped-station', 'PUT')).status).toBe(403);
    await env.DB.prepare("UPDATE agent_tokens SET revoked_at='now' WHERE id=?")
      .bind(originator.record.id)
      .run();
    expect((await runtimeRead(`/productions/${production.id}`)).status).toBe(403);
    expect((await api(`/productions/${production.id}`, executor)).status).toBe(200);
  });

  it('rejects missing, terminal, expired and unowned command authority', async () => {
    const secret = await issue([...submissionScopes, 'productions:read']);
    const actor = await principal(secret);
    await expect(commandOrigin(env.DB, 'missing')).rejects.toMatchObject({ status: 409 });
    await api('/tasks', secret, 'POST', task('terminal'));
    for (const status of ['complete', 'failed', 'cancelled', 'cancelling']) {
      await env.DB.prepare('UPDATE agent_commands SET status=? WHERE id=?').bind(status, 'terminal').run();
      await expect(commandOrigin(env.DB, 'terminal')).rejects.toMatchObject({ status: 409 });
    }
    expect(await commandOrigin(env.DB, 'terminal', false)).toMatchObject({ tokenId: secret.record.id });
    await env.DB.prepare(
      "UPDATE agent_commands SET status='queued', data=json_remove(data,'$.principal') WHERE id='terminal'",
    ).run();
    await expect(commandOrigin(env.DB, 'terminal')).rejects.toMatchObject({ status: 403 });
    await expect(currentPrincipal(env.DB, { ...actor, expiresAt: Date.now() - 1 })).rejects.toMatchObject({
      status: 403,
    });
    await expect(currentPrincipal(env.DB, { ...actor, tokenId: undefined })).rejects.toMatchObject({
      status: 403,
    });
    await env.DB.prepare("UPDATE agent_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .bind(secret.record.id)
      .run();
    await expect(currentPrincipal(env.DB, actor)).rejects.toMatchObject({ status: 403 });
    const human: Principal = { kind: 'human', name: 'Fixture owner' };
    expect(await currentPrincipal(env.DB, human)).toBe(human);
  });
});
