import { readFileSync } from 'node:fs';
import {
  type AgentOperation,
  defaultSpeechSettings,
  type PageContext,
  type Principal,
  type Scope,
  type ServerFrame,
  scopePresets,
  serverFrameSchema,
} from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentHub } from '../../worker/agent-hub';
import {
  type ConnectionIdentity,
  connectRuntime,
  notifyProductionChanged,
  requireRuntimeOrigin,
  routeRuntimeAdmin,
  routeRuntimeReceipt,
} from '../../worker/agent-runtime';
import {
  executeOperation,
  operationFence,
  operationOrigin,
  operationReceipt,
  persistOperationFailure,
  readReceipt,
} from '../../worker/agent-runtime-operation';
import {
  digest,
  enqueue,
  persistEvent,
  requireCommand,
  runtimeSnapshot,
  saveContext,
  station,
} from '../../worker/agent-runtime-store';
import { authenticateAgent, routeAgentTokens } from '../../worker/agent-tokens';
import * as audioRoutes from '../../worker/audio-routes';
import { localLogin } from '../../worker/auth';
import { HttpError } from '../../worker/http';
import { queueSpeech } from '../../worker/native-speech';
import * as productionRoutes from '../../worker/production';
import { getProduction } from '../../worker/production-store';
import { agent, brief, fixture, human, readyFixture } from './production-fixture';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const origin = 'https://hisfm.dev.hexly.ai';
let miniflare: Miniflare;
let env: Env;
let hub: AgentHub;
let sockets: FakeSocket[];
let token: string;
let tokenId: string;
let cookie: string;
const alarm = { setAlarm: vi.fn(), deleteAlarm: vi.fn() };
const context: PageContext = {
  tabId: 'tab1',
  pageEpoch: 1,
  seq: 1,
  route: '/admin/productions/p1',
  productionId: 'p1',
  step: 'brief',
  sourceId: null,
  version: 1,
  field: { productionId: 'p1', field: 'title' },
  draft: { revision: 1, value: 'Draft', baseValue: 'Original' },
  selection: null,
  activity: 'editing',
};
const command = { id: 'cmd1', text: 'Please improve the title', context };

class FakeSocket {
  readyState = 1;
  frames: unknown[] = [];
  deliveries: ServerFrame[] = [];
  attachment: unknown;
  failed = false;
  close = vi.fn(() => {
    this.readyState = 3;
  });
  send(data: string) {
    if (this.failed) throw new Error('closed');
    const parsed = serverFrameSchema.parse(JSON.parse(data));
    this.deliveries.push(parsed);
    const { deliveryId: _deliveryId, ...frame } = parsed;
    this.frames.push(frame);
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  socket() {
    return this as unknown as WebSocket;
  }
}

function request(path: string, method = 'GET', data?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
function machine(path = '/api/agent/runtime/connect', extra: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Hisfm-Station': 'station1',
      Upgrade: 'websocket',
      ...extra,
    },
  });
}
async function enroll(version?: number) {
  return routeRuntimeAdmin(
    request('/admin/api/agent/station', 'POST', {
      tokenId,
      stationId: 'station1',
      ...(version === undefined ? {} : { version }),
    }),
    env,
    human,
  );
}
async function connect(role: 'browser' | 'agent' = 'agent') {
  const response =
    role === 'agent'
      ? await connectRuntime(machine(), env)
      : await connectRuntime(
          request('/admin/api/agent/live?protocol=1', 'GET', undefined, { Upgrade: 'websocket' }),
          env,
          human,
        );
  expect(response.status).toBe(101);
  return sockets.at(-1) as FakeSocket;
}
async function frame(socket: FakeSocket, data: unknown) {
  await hub.webSocketMessage(socket.socket(), JSON.stringify(data));
}
async function start(scope: PageContext | null = null, text = command.text) {
  await enroll();
  await enqueue(env.DB, { ...command, text, context: scope }, human);
  return connect();
}
function identity(socket: FakeSocket) {
  const value = socket.attachment as ConnectionIdentity;
  return {
    tokenId: value.tokenId,
    stationVersion: value.stationVersion,
    generation: value.connectionId,
    expiresAt: value.expiresAt,
  };
}
function executor(socket: FakeSocket) {
  return (socket.attachment as ConnectionIdentity).actor;
}
async function insertProduction(production = fixture()) {
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

async function issuePrincipal(scopes: Scope[] = scopePresets.owner) {
  const response = await routeAgentTokens(
    request('/admin/api/agent-tokens', 'POST', { name: 'Originator', expiresInDays: 1, scopes }),
    env,
    '/admin/api/agent-tokens',
    human,
  );
  const issued = (await response.json()) as { token: string };
  return authenticateAgent(
    new Request(origin, { headers: { Authorization: `Bearer ${issued.token}` } }),
    env,
  );
}

beforeAll(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'runtime-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("test")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'runtime-test' },
            MEDIA: { type: 'r2', name: 'runtime-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  env = await miniflare.getBindings<Env>();
  for (const filename of [
    '0001_episodes.sql',
    '0003_production.sql',
    '0004_audio.sql',
    '0005_channel.sql',
    '0007_agent_runtime.sql',
    '0009_native_speech.sql',
    '0010_categories.sql',
    '0011_prompts.sql',
    '0012_token_scopes.sql',
  ]) {
    const sql = readFileSync(new URL(`../../migrations/${filename}`, import.meta.url), 'utf8');
    await env.DB.batch(
      sql
        .split(';')
        .filter((statement) => statement.trim())
        .map((statement) => env.DB.prepare(statement)),
    );
  }
  const NativeResponse = Response;
  vi.stubGlobal(
    'Response',
    class extends NativeResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(body, init?.status === 101 ? { status: 200 } : init);
        if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 });
      }
    },
  );
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = new FakeSocket();
      1 = new FakeSocket();
    },
  );
});
beforeEach(async () => {
  vi.clearAllMocks();
  sockets = [];
  await env.DB.batch(
    [
      'speech_jobs',
      'bumpers',
      'agent_receipts',
      'agent_station',
      'agent_tokens',
      'agent_commands',
      'agent_events',
      'agent_contexts',
      'agent_proposals',
      'agent_write_fence',
      'productions',
      'audio_jobs',
      'production_settings',
      'local_sessions',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  const state = {
    storage: alarm,
    getWebSockets: () => sockets,
    acceptWebSocket: (socket: FakeSocket) => sockets.push(socket),
  } as unknown as DurableObjectState;
  hub = new AgentHub(state, env);
  env.AGENT_HUB = {
    getByName: () => ({
      fetch: (input: string | Request, init?: RequestInit) =>
        hub.fetch(typeof input === 'string' ? new Request(input, init) : input),
    }),
  } as unknown as Env['AGENT_HUB'];
  const minted = await routeAgentTokens(
    request('/admin/api/agent-tokens', 'POST', {
      name: 'Runtime test',
      expiresInDays: 1,
      scopes: agent.scopes,
    }),
    env,
    '/admin/api/agent-tokens',
    human,
  );
  const secret = (await minted.json()) as { token: string; record: { id: string } };
  token = secret.token;
  tokenId = secret.record.id;
  const login = await localLogin(request('/admin/api/dev-login', 'POST'), env);
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  await insertProduction(fixture({ id: 'p1', slug: 'context-fixture' }));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await miniflare.dispose();
});

describe('durable runtime stores', () => {
  it('persists frozen command context independently of a newer page pointer and sends stale proposals for browser reconciliation', async () => {
    await saveContext(env.DB, { ...context, seq: 10 });
    const saved = await enqueue(env.DB, command, human);
    expect(saved.command.context).toEqual(context);
    expect(
      await env.DB.prepare('SELECT seq FROM agent_contexts WHERE tab_id = ?')
        .bind(context.tabId)
        .first('seq'),
    ).toBe(10);
    const proposal = {
      id: 'frozen-proposal',
      commandId: command.id,
      context,
      target: context.field as NonNullable<PageContext['field']>,
      value: 'Proposal',
      summary: 'Frozen original',
    };
    expect(await persistEvent(env.DB, { type: 'proposal', proposal })).toEqual({
      id: proposal.id,
      inserted: true,
    });
    await expect(
      enqueue(
        env.DB,
        {
          ...command,
          id: 'bad-production',
          context: { ...context, productionId: 'missing', field: null },
        },
        human,
      ),
    ).rejects.toThrow('不存在');
    await expect(
      enqueue(
        env.DB,
        {
          ...command,
          id: 'bad-source',
          context: { ...context, sourceId: 'missing', field: null },
        },
        human,
      ),
    ).rejects.toThrow('来源');
  });
  it('hashes canonical objects and deduplicates commands without losing their creation time', async () => {
    expect(await digest({ b: [2, 1], a: null })).toBe(await digest({ a: null, b: [2, 1] }));
    const first = await enqueue(env.DB, command, human);
    expect(first.inserted).toBe(true);
    expect(await enqueue(env.DB, command, human)).toEqual({ ...first, inserted: false });
    await expect(enqueue(env.DB, { ...command, text: 'Different' }, human)).rejects.toThrow('ID');
    await expect(requireCommand(env.DB, 'missing')).rejects.toThrow('不存在');
    await expect(requireCommand(env.DB, command.id, true)).resolves.toEqual({ status: 'queued' });
    const longest = { ...command, id: 'x'.repeat(160), context: null };
    await enqueue(env.DB, longest, human);
    expect(serverFrameSchema.safeParse(await runtimeSnapshot(env.DB, false)).success).toBe(true);
    await expect(
      persistEvent(env.DB, {
        type: 'message',
        message: {
          id: longest.id,
          role: 'assistant',
          commandId: null,
          text: 'Impersonated identity',
          createdAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow('冲突');
  });
  it('orders each tab by page epoch then sequence, rejects equal-sequence conflicts', async () => {
    expect(await saveContext(env.DB, context)).toBe(true);
    expect(await saveContext(env.DB, context)).toBe(false);
    for (const changes of [{ seq: 0 }, { pageEpoch: 0, seq: 10 }, { route: '/other' }])
      await expect(saveContext(env.DB, { ...context, ...changes })).rejects.toThrow('过期');
    await saveContext(env.DB, { ...context, seq: 2 });
    await saveContext(env.DB, { ...context, pageEpoch: 2, seq: 0 });
    await saveContext(env.DB, { ...context, tabId: 'tab2' });
  });
  it('persists agent messages, status, proposals and terminal states before reconstructing snapshots', async () => {
    await enqueue(env.DB, command, human);
    await saveContext(env.DB, context);
    const message = {
      type: 'message' as const,
      message: {
        id: 'msg1',
        role: 'assistant' as const,
        text: 'Done',
        commandId: command.id,
        createdAt: new Date().toISOString(),
      },
    };
    expect(await persistEvent(env.DB, message)).toEqual({ id: 'msg1', inserted: true });
    expect((await persistEvent(env.DB, message)).inserted).toBe(false);
    await expect(
      persistEvent(env.DB, { ...message, message: { ...message.message, text: 'Changed' } }),
    ).rejects.toThrow('ID');
    await expect(
      persistEvent(env.DB, { ...message, message: { ...message.message, id: 'fake-user', role: 'user' } }),
    ).rejects.toThrow('冒充');
    await persistEvent(env.DB, { type: 'status', id: 'status1', conversations: [] });
    const proposal = {
      id: 'proposal1',
      commandId: command.id,
      context,
      target: context.field as NonNullable<PageContext['field']>,
      value: 'Better',
      summary: 'Title',
    };
    await persistEvent(env.DB, { type: 'proposal', proposal });
    await expect(
      persistEvent(env.DB, {
        type: 'proposal',
        proposal: { ...proposal, id: 'bad-proposal', context: { ...context, seq: 0 } },
      }),
    ).rejects.toThrow('过期');
    await persistEvent(env.DB, {
      type: 'command.state',
      id: 'state1',
      commandId: command.id,
      status: 'complete',
      detail: 'Done',
    });
    await expect(requireCommand(env.DB, command.id, true)).rejects.toThrow('已结束');
    const snapshot = await runtimeSnapshot(env.DB, false);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.proposals).toEqual([proposal]);
    expect(snapshot.commands).toEqual([{ id: command.id, status: 'complete', detail: 'Done' }]);
    expect(serverFrameSchema.parse(snapshot)).toEqual(snapshot);
  });
});

describe('runtime enrollment and boundaries', () => {
  it('requires explicit human binding, replaces only by exact version and fences old sockets', async () => {
    expect(await (await routeRuntimeAdmin(request('/admin/api/agent/station'), env, human)).json()).toEqual({
      station: null,
    });
    await expect(connectRuntime(machine(), env)).rejects.toThrow('绑定');
    await expect(enroll(2)).rejects.toThrow('版本');
    expect((await enroll()).status).toBe(200);
    expect(await (await routeRuntimeAdmin(request('/admin/api/agent/station'), env, human)).json()).toEqual({
      station: { tokenId, stationId: 'station1', version: 1 },
    });
    await expect(enroll()).rejects.toThrow('版本');
    await expect(enroll(3)).rejects.toThrow('版本');
    const socket = await connect();
    expect((await connectRuntime(machine(), env)).status).toBe(409);
    await enroll(1);
    expect(socket.close).toHaveBeenCalled();
    expect((await station(env.DB))?.version).toBe(2);
    expect((await connectRuntime(machine(), env)).status).toBe(101);
  });
  it('rejects revoked enrollment, forbidden origins, domains, methods and connection parameters', async () => {
    await expect(
      routeRuntimeAdmin(
        request('/admin/api/agent/station', 'POST', { tokenId: 'invalid', stationId: 'station1' }),
        env,
        human,
      ),
    ).rejects.toThrow('有效');
    await expect(
      routeRuntimeAdmin(request('/admin/api/agent/station', 'DELETE'), env, human),
    ).rejects.toThrow('方式');
    await expect(routeRuntimeAdmin(request('/admin/api/agent/unknown'), env, human)).rejects.toThrow(
      '不存在',
    );
    await expect(connectRuntime(request('/admin/api/agent/live', 'POST'), env, human)).rejects.toThrow('GET');
    await expect(connectRuntime(request('/admin/api/agent/live'), env, human)).rejects.toThrow('升级');
    for (const suffix of ['?token=secret', '?protocol=2', '?protocol=1&protocol=1'])
      expect(() => requireRuntimeOrigin(machine(`/api/agent/runtime/connect${suffix}`), env, false)).toThrow(
        '参数',
      );
    expect(() =>
      requireRuntimeOrigin(machine('/api/agent/runtime/connect', { Origin: origin }), env, false),
    ).toThrow('Origin');
    expect(() =>
      requireRuntimeOrigin(new Request('https://evil.example/admin/api/agent/live'), env, true),
    ).toThrow('域名');
    expect(() =>
      requireRuntimeOrigin(request('/admin/api/agent/live'), { ...env, ENVIRONMENT: 'production' }, true),
    ).toThrow('域名');
    expect(() =>
      requireRuntimeOrigin(
        new Request('https://his.fm/api/agent/runtime/connect'),
        { ...env, ENVIRONMENT: 'production' },
        false,
      ),
    ).not.toThrow();
    expect(() =>
      requireRuntimeOrigin(
        new Request(`${origin}/admin/api/agent/live`, { headers: { Origin: 'https://evil.example' } }),
        env,
        true,
      ),
    ).toThrow('本站');
    expect(
      (
        await routeRuntimeAdmin(
          new Request(`${origin}/admin/api/agent/snapshot`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }),
          env,
          human,
        )
      ).status,
    ).toBe(200);
    await expect(
      connectRuntime(
        request('/admin/api/agent/live', 'GET', undefined, { Cookie: '', Upgrade: 'websocket' }),
        env,
        human,
      ),
    ).rejects.toThrow('登录');
  });
});

describe('hibernating socket lifecycle', () => {
  it('replays nonterminal commands and contexts on reconnect, persists before ACK and broadcasts only to intended roles', async () => {
    const browser = await connect('browser');
    await frame(browser, { type: 'context', context });
    await frame(browser, { type: 'command', ...command });
    expect(browser.frames).toContainEqual({ type: 'command.ack', id: command.id });
    await enroll();
    const machineSocket = await connect();
    expect(machineSocket.frames).toContainEqual({ type: 'context', context });
    expect(machineSocket.frames).toContainEqual({
      type: 'command',
      command: expect.objectContaining(command),
    });
    await frame(machineSocket, { type: 'accepted', commandId: command.id });
    expect(await requireCommand(env.DB, command.id)).toEqual({ status: 'accepted' });
    await frame(machineSocket, {
      type: 'message',
      message: {
        id: 'reply',
        role: 'assistant',
        text: 'Hello',
        commandId: command.id,
        createdAt: '2026-10-03T00:00:00Z',
      },
    });
    expect(machineSocket.frames.at(-1)).toEqual({ type: 'event.ack', id: 'reply' });
    await frame(machineSocket, { type: 'status', id: 'status', conversations: [] });
    await frame(browser, { type: 'ping' });
    await frame(machineSocket, { type: 'ping' });
    expect(browser.frames.at(-1)).toEqual({ type: 'pong' });
    expect(machineSocket.frames.at(-1)).toEqual({ type: 'pong' });
    await hub.webSocketClose(machineSocket.socket());
    const restored = await connect();
    expect(restored.frames).toContainEqual({ type: 'command', command: expect.objectContaining(command) });
    await frame(browser, { type: 'cancel', commandId: command.id });
    expect(restored.frames.at(-1)).toEqual({ type: 'cancel', commandId: command.id });
    expect(await requireCommand(env.DB, command.id)).toEqual({ status: 'cancelling' });
    await hub.webSocketError(restored.socket());
    const final = await connect();
    expect(final.frames.some((value) => (value as { type: string }).type === 'command')).toBe(false);
    expect(final.frames).toContainEqual({ type: 'cancel', commandId: command.id });
    await frame(final, {
      type: 'command.state',
      id: 'cancelled',
      commandId: command.id,
      status: 'cancelled',
      detail: '',
    });
    expect(await requireCommand(env.DB, command.id)).toEqual({ status: 'cancelled' });
    expect(browser.frames).not.toContainEqual({ type: 'context', context });
  });
  it('persists proposal acknowledgments, rejects conflicts and reports malformed frames', async () => {
    const machineSocket = await start(context);
    const browser = await connect('browser');
    await frame(browser, { type: 'context', context });
    const proposal = {
      id: 'proposal',
      commandId: command.id,
      context,
      target: context.field,
      value: 'New title',
      summary: 'Title',
    };
    await frame(machineSocket, { type: 'proposal', proposal });
    expect(browser.frames.at(-1)).toEqual({ type: 'proposal', proposal });
    await frame(browser, { type: 'proposal.ack', id: 'proposal', status: 'applied' });
    expect((await runtimeSnapshot(env.DB, true)).proposals).toEqual([]);
    await frame(machineSocket, { type: 'proposal', proposal });
    expect(machineSocket.frames.at(-1)).toEqual({ type: 'proposal.ack', id: 'proposal', status: 'applied' });
    await frame(browser, { type: 'proposal.ack', id: 'proposal', status: 'rejected' });
    expect(browser.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_409' });
    for (const socket of [machineSocket, browser]) {
      await frame(socket, { type: 'invalid' });
      expect(socket.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_400' });
      await hub.webSocketMessage(socket.socket(), '{');
      expect(socket.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_400' });
      await hub.webSocketMessage(socket.socket(), new ArrayBuffer(1));
      expect(socket.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_413' });
      await hub.webSocketMessage(socket.socket(), 'x'.repeat(262145));
      expect(socket.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_413' });
    }
    machineSocket.failed = true;
    await frame(machineSocket, { type: 'ping' });
    expect(machineSocket.close).toHaveBeenCalledWith(1011, expect.any(String));
  });
  it('expires heartbeat and auth leases, detects revocation and session deletion, enforces browser capacity', async () => {
    const machineSocket = await start();
    const browser = await connect('browser');
    expect((machineSocket.attachment as ConnectionIdentity).expiresAt - Date.now()).toBeLessThanOrEqual(
      900000,
    );
    for (let index = 1; index < 12; index++) await connect('browser');
    expect(
      (
        await connectRuntime(
          request('/admin/api/agent/live', 'GET', undefined, { Upgrade: 'websocket' }),
          env,
          human,
        )
      ).status,
    ).toBe(429);
    await env.DB.prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), tokenId)
      .run();
    await hub.alarm();
    expect(machineSocket.close).toHaveBeenCalledWith(4001, expect.any(String));
    await env.DB.prepare('DELETE FROM local_sessions').run();
    await frame(browser, { type: 'ping' });
    expect(browser.close).toHaveBeenCalledWith(4001, expect.any(String));
    await hub.alarm();
    expect(alarm.deleteAlarm).toHaveBeenCalled();
    const detached = new FakeSocket();
    detached.serializeAttachment({
      ...(browser.attachment as ConnectionIdentity),
      sessionHash: null,
      lastSeen: Date.now() - 35001,
    });
    sockets.push(detached);
    await hub.alarm();
    expect(detached.close).toHaveBeenCalledWith(1013, expect.any(String));
    const expired = new FakeSocket();
    expired.serializeAttachment({
      ...(browser.attachment as ConnectionIdentity),
      sessionHash: null,
      lastSeen: Date.now(),
      expiresAt: Date.now() - 1,
    });
    sockets.push(expired);
    await hub.alarm();
    expect(expired.close).toHaveBeenCalledWith(4002, expect.any(String));
  });
  it('renews natural socket authorization expiry through a new authenticated connection', async () => {
    const browser = await connect('browser');
    browser.serializeAttachment({ ...(browser.attachment as ConnectionIdentity), expiresAt: Date.now() - 1 });
    await frame(browser, { type: 'ping' });
    expect(browser.close).toHaveBeenCalledWith(4002, expect.any(String));
    const renewedBrowser = await connect('browser');
    expect((renewedBrowser.attachment as ConnectionIdentity).expiresAt).toBeGreaterThan(Date.now());
    expect((renewedBrowser.attachment as ConnectionIdentity).connectionId).not.toBe(
      (browser.attachment as ConnectionIdentity).connectionId,
    );
    const machineSocket = await start();
    machineSocket.serializeAttachment({
      ...(machineSocket.attachment as ConnectionIdentity),
      expiresAt: Date.now() - 1,
    });
    await hub.alarm();
    expect(machineSocket.close).toHaveBeenCalledWith(4002, expect.any(String));
    const renewedMachine = await connect();
    expect((renewedMachine.attachment as ConnectionIdentity).expiresAt).toBeGreaterThan(Date.now());
    await env.DB.prepare('DELETE FROM local_sessions').run();
    await expect(
      connectRuntime(
        request('/admin/api/agent/live', 'GET', undefined, { Upgrade: 'websocket' }),
        env,
        human,
      ),
    ).rejects.toThrow('登录');
  });
});

describe('operation fencing and exact durable receipts', () => {
  it('creates once, replays receipts, rejects reused IDs, retains agent actor and broadcasts changed versions', async () => {
    const socket = await start();
    const browser = await connect('browser');
    const operation: AgentOperation = {
      kind: 'production.create',
      id: 'op-create',
      commandId: command.id,
      brief,
    };
    await frame(socket, { type: 'operation', operation });
    const receipt = await readReceipt(env.DB, operation.id, human);
    expect(receipt).toMatchObject({ ok: true, status: 201 });
    if (!receipt) throw new Error('Missing committed receipt');
    const production = (receipt.result as { production: ReturnType<typeof fixture> }).production;
    expect(production.events[0].actor.kind).toBe('agent');
    expect(browser.frames.at(-1)).toEqual({
      type: 'production.changed',
      productionId: production.id,
      version: 1,
    });
    expect(await executeOperation(env, executor(socket), identity(socket), operation)).toEqual(receipt);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM productions').first('count')).toBe(2);
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...operation,
        brief: { ...brief, title: 'other' },
      }),
    ).rejects.toThrow('ID');
    expect(
      await (await routeRuntimeReceipt(machine(`/api/agent/runtime/receipts/${operation.id}`), env)).json(),
    ).toEqual({ receipt });
    await expect(readReceipt(env.DB, 'missing', human)).rejects.toThrow('不存在');
    await env.DB.prepare('INSERT INTO agent_receipts (id, hash, command_id) VALUES (?, ?, ?)')
      .bind('pending', 'hash', command.id)
      .run();
    expect((await routeRuntimeReceipt(machine('/api/agent/runtime/receipts/pending'), env)).status).toBe(202);
    await expect(
      routeRuntimeReceipt(
        new Request(`${origin}/api/agent/runtime/receipts/pending`, { method: 'POST' }),
        env,
      ),
    ).rejects.toThrow('GET');
    await expect(
      routeRuntimeReceipt(
        machine('/api/agent/runtime/receipts/pending', { 'X-Hisfm-Station': 'other' }),
        env,
      ),
    ).rejects.toThrow('绑定');
  });
  it('uses exact versions and existing domain permission rules without granting approval', async () => {
    const production = await insertProduction();
    const socket = await start({ ...context, productionId: production.id, field: null });
    const operation: AgentOperation = {
      kind: 'production.patch',
      id: 'patch',
      commandId: command.id,
      productionId: production.id,
      version: 1,
      changes: { title: 'Changed', version: 500 },
    };
    expect(await executeOperation(env, executor(socket), identity(socket), operation)).toMatchObject({
      ok: true,
      result: { production: { title: 'Changed', version: 2 } },
    });
    expect(
      await executeOperation(env, executor(socket), identity(socket), { ...operation, id: 'stale' }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await executeOperation(env, executor(socket), identity(socket), {
        kind: 'production.action',
        id: 'submit',
        commandId: command.id,
        productionId: production.id,
        version: 2,
        action: 'submit_brief',
      }),
    ).toMatchObject({ ok: true, result: { production: { stage: 'brief_review', version: 3 } } });
    await frame(socket, {
      type: 'operation',
      operation: {
        kind: 'production.action',
        id: 'approval',
        commandId: command.id,
        productionId: production.id,
        version: 3,
        action: 'approve_brief',
      },
    });
    expect(socket.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_400' });
    expect((await getProduction(env.DB, production.id)).approvals.brief).toBeNull();
  });
  it('authorizes an unscoped command only for productions created by its own committed create receipt', async () => {
    const socket = await start();
    const created = await executeOperation(env, executor(socket), identity(socket), {
      kind: 'production.create',
      id: 'create-owned',
      commandId: command.id,
      brief,
    });
    const production = (created.result as { production: ReturnType<typeof fixture> }).production;
    const patch: AgentOperation = {
      kind: 'production.patch',
      id: 'patch-owned',
      commandId: command.id,
      productionId: production.id,
      version: 1,
      changes: { intent: 'Same-command continuation' },
    };
    expect(await executeOperation(env, executor(socket), identity(socket), patch)).toMatchObject({
      ok: true,
      result: { production: { version: 2 } },
    });
    expect(
      await executeOperation(env, executor(socket), identity(socket), {
        kind: 'production.action',
        id: 'submit-owned',
        commandId: command.id,
        productionId: production.id,
        version: 2,
        action: 'submit_brief',
      }),
    ).toMatchObject({ ok: true, result: { production: { stage: 'brief_review' } } });
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...patch,
        id: 'arbitrary-production',
        productionId: 'p1',
      }),
    ).rejects.toThrow('范围');
    await enqueue(env.DB, { ...command, id: 'other-command', context: null }, human);
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...patch,
        id: 'other-command-write',
        commandId: 'other-command',
        version: 3,
      }),
    ).rejects.toThrow('范围');
    await enqueue(env.DB, { ...command, id: 'page-command', context: { ...context, field: null } }, human);
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...patch,
        id: 'wrong-page-write',
        commandId: 'page-command',
        version: 3,
      }),
    ).rejects.toThrow('范围');
    await env.DB.prepare('UPDATE agent_receipts SET response = NULL WHERE id = ?').bind('create-owned').run();
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...patch,
        id: 'pending-create',
        version: 3,
      }),
    ).rejects.toThrow('范围');
    await env.DB.prepare('UPDATE agent_receipts SET response = ? WHERE id = ?')
      .bind(JSON.stringify({ ...created, ok: false }), 'create-owned')
      .run();
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...patch,
        id: 'failed-create',
        version: 3,
      }),
    ).rejects.toThrow('范围');
  });
  it('rolls back mutation and receipt when a station generation is fenced', async () => {
    const production = await insertProduction();
    const socket = await start({ ...context, productionId: production.id, field: null });
    const operation: AgentOperation = {
      kind: 'production.patch',
      id: 'fenced',
      commandId: command.id,
      productionId: production.id,
      version: 1,
      changes: { title: 'Forbidden' },
    };
    await env.DB.prepare("UPDATE agent_station SET generation = 'new-generation'").run();
    await expect(executeOperation(env, executor(socket), identity(socket), operation)).rejects.toThrow(
      '租约',
    );
    expect(await readReceipt(env.DB, operation.id, human)).toBeNull();
    expect((await getProduction(env.DB, production.id)).version).toBe(1);
    await frame(socket, { type: 'operation', operation });
    expect(socket.close).toHaveBeenCalled();
  });
  it('never creates a successful receipt when the exact production CAS loses a race', async () => {
    const production = await insertProduction();
    const socket = await start({ ...context, productionId: production.id, field: null });
    const racedDb = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare(
          "UPDATE productions SET version = 2, data = json_set(data, '$.version', 2) WHERE id = ? AND version = 1",
        )
          .bind(production.id)
          .run();
        return env.DB.batch(statements);
      },
    } as D1Database;
    const operation: AgentOperation = {
      kind: 'production.patch',
      id: 'cas-race',
      commandId: command.id,
      productionId: production.id,
      version: 1,
      changes: { title: 'Must not commit' },
    };
    expect(
      await executeOperation({ ...env, DB: racedDb }, executor(socket), identity(socket), operation),
    ).toMatchObject({ ok: false, status: 409 });
    expect(await readReceipt(env.DB, operation.id, human)).toMatchObject({ ok: false, status: 409 });
    expect((await getProduction(env.DB, production.id)).title).toBe(production.title);
  });
  it('notifies human mutation versions and skips unsuccessful or nonproduction responses', async () => {
    const browser = await connect('browser');
    await notifyProductionChanged(env, Response.json({ production: { id: 'human-edit', version: 2 } }));
    expect(browser.frames.at(-1)).toEqual({
      type: 'production.changed',
      productionId: 'human-edit',
      version: 2,
    });
    await notifyProductionChanged(env, Response.json({ settings: {} }));
    await notifyProductionChanged(env, new Response(null, { status: 409 }));
    expect((await hub.fetch(new Request('https://hub/unknown'))).status).toBe(404);
    expect((await hub.fetch(new Request('https://hub/connect'))).status).toBe(401);
  });
});

describe('bounded delivery and context-scoped mutation', () => {
  it('proxies allowlisted native settings without persisting secrets or serial-queue deadlocks', async () => {
    expect(
      (
        await hub.fetch(
          new Request('https://hub/runtime-request', {
            method: 'POST',
            body: JSON.stringify({ kind: 'settings.read' }),
          }),
        )
      ).status,
    ).toBe(503);
    const socket = await start();
    const status = {
      version: '0'.repeat(64),
      settings: defaultSpeechSettings,
      providers: { gemini: true, elevenlabs: false, raven: true, decision: true },
      coordinator: { provider: 'raven', model: 'gpt-6-astra', thinkingLevel: 'high' },
      executor: { provider: 'raven', model: 'gpt-6.1-sol', thinkingLevels: ['low'] },
      decision: { model: 'jev-latest', maxInputBytes: 16384, maxBatchQuestions: 12 },
    };
    expect(
      (await hub.fetch(new Request('https://hub/runtime-request', { method: 'POST', body: '{}' }))).status,
    ).toBe(400);
    const pending = hub.fetch(
      new Request('https://hub/runtime-request', {
        method: 'POST',
        body: JSON.stringify({ kind: 'settings.read' }),
      }),
    );
    await expect
      .poll(() => socket.frames.some((value) => (value as { type: string }).type === 'runtime.request'))
      .toBe(true);
    const sent = socket.frames.find((value) => (value as { type: string }).type === 'runtime.request') as {
      id: string;
    };
    await frame(socket, { type: 'runtime.response', id: sent.id, ok: true, result: status });
    expect(await (await pending).json()).toEqual(status);
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM agent_events WHERE type='runtime.response'").first('n'),
    ).toBe(0);
    socket.frames = [];
    const invalid = hub.fetch(
      new Request('https://hub/runtime-request', {
        method: 'POST',
        body: JSON.stringify({ kind: 'settings.read' }),
      }),
    );
    await expect.poll(() => socket.frames.length).toBeGreaterThan(0);
    const id = (socket.frames[0] as { id: string }).id;
    await frame(socket, {
      type: 'runtime.response',
      id,
      ok: true,
      result: { ...status, apiKey: 'private-key' },
    });
    const response = await invalid;
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('private-key');
    await frame(socket, { type: 'runtime.response', id: 'unknown', ok: false, result: {} });
    const timed = hub.fetch(
      new Request('https://hub/runtime-request', {
        method: 'POST',
        body: JSON.stringify({ kind: 'settings.read' }),
      }),
    );
    expect((await timed).status).toBe(504);
  });
  it('dispatches queued speech and retires failed commands without erasing completed results', async () => {
    const socket = await start();
    const input = {
      provider: 'gemini' as const,
      model: 'gemini-3.8-flash-tts',
      voice: 'Kore',
      speakingStyle: 'calm',
      text: '你好',
      stability: 0.5,
      similarity: 0.75,
    };
    await queueSpeech(env, 'preview', 'preview', input, null, human);
    await hub.fetch(new Request('https://hub/speech-queued'));
    expect(socket.frames).toContainEqual(
      expect.objectContaining({
        type: 'command',
        command: expect.objectContaining({ id: expect.stringContaining('speech:preview:') }),
      }),
    );
    await env.DB.prepare(
      "UPDATE agent_commands SET status='failed' WHERE id IN (SELECT command_id FROM speech_jobs)",
    ).run();
    await hub.alarm();
    expect(await env.DB.prepare("SELECT status FROM speech_jobs WHERE id='preview'").first('status')).toBe(
      'failed',
    );
    await queueSpeech(env, 'preview', 'preview', input, null, human);
    await hub.alarm();
    expect(await env.DB.prepare("SELECT status FROM speech_jobs WHERE id='preview'").first('status')).toBe(
      'queued',
    );
    await env.DB.prepare("UPDATE speech_jobs SET status='complete', result='{}'").run();
    await hub.alarm();
    expect(await env.DB.prepare("SELECT status FROM speech_jobs WHERE id='preview'").first('status')).toBe(
      'complete',
    );
  });
  it('uses cumulative bounded delivery acknowledgements, rejects zero and future watermarks', async () => {
    const browser = await connect('browser');
    expect(browser.deliveries.find((value) => value.type === 'snapshot')?.deliveryId).toBe(1);
    await frame(browser, { type: 'delivery.ack', deliveryId: 0 });
    expect(browser.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_400' });
    await frame(browser, { type: 'delivery.ack', deliveryId: 2 });
    expect(browser.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_400' });
    await frame(browser, { type: 'delivery.ack', deliveryId: 1 });
    expect((browser.attachment as ConnectionIdentity).delivery?.pending).toEqual([]);
    for (let index = 0; index < 140; index++) {
      await notifyProductionChanged(env, Response.json({ production: { id: 'p1', version: index + 1 } }));
      await frame(browser, { type: 'delivery.ack', deliveryId: index + 2 });
    }
    expect(browser.close).not.toHaveBeenCalled();
    await frame(browser, { type: 'delivery.ack', deliveryId: 1 });
    expect((browser.attachment as ConnectionIdentity).delivery?.acknowledged).toBe(141);
    for (let index = 0; index < 129; index++)
      await notifyProductionChanged(env, Response.json({ production: { id: 'p1', version: index + 1 } }));
    expect(browser.close).toHaveBeenCalledWith(1013, expect.any(String));
  });

  it('closes a byte-limited viewer independently without dropping persisted messages or receipts', async () => {
    const socket = await start();
    const slow = await connect('browser');
    const fast = await connect('browser');
    for (let index = 0; index < 28; index++) {
      await frame(socket, {
        type: 'message',
        message: {
          id: `large-${index}`,
          role: 'assistant',
          text: 'x'.repeat(80000),
          commandId: command.id,
          createdAt: new Date(index).toISOString(),
        },
      });
      const delivery = fast.deliveries.at(-1)?.deliveryId;
      await frame(fast, { type: 'delivery.ack', deliveryId: delivery });
    }
    expect(slow.close).toHaveBeenCalledWith(1013, expect.any(String));
    expect(fast.close).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    const snapshot = await runtimeSnapshot(env.DB, true);
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThanOrEqual(240 * 1024);
    const first = (await (
      await routeRuntimeAdmin(request('/admin/api/agent/history'), env, human)
    ).json()) as { items: unknown[]; nextCursor: number };
    expect(first.items).toHaveLength(20);
    const second = (await (
      await routeRuntimeAdmin(request(`/admin/api/agent/history?before=${first.nextCursor}`), env, human)
    ).json()) as { items: unknown[]; nextCursor: number | null };
    expect(second.items).toHaveLength(8);
    expect(second.nextCursor).toBeNull();
    expect(
      await env.DB.prepare("SELECT count(*) FROM agent_events WHERE type = 'message'").first('count(*)'),
    ).toBe(28);
    for (const path of [
      '/admin/api/agent/history?before=0',
      '/admin/api/agent/history?kind=secret',
      '/admin/api/agent/history?extra=x',
    ])
      await expect(routeRuntimeAdmin(request(path), env, human)).rejects.toThrow('参数');
    await expect(routeRuntimeAdmin(request('/admin/api/agent/history', 'POST'), env, human)).rejects.toThrow(
      'GET',
    );
    expect(
      await (await routeRuntimeAdmin(request('/admin/api/agent/history?kind=proposals'), env, human)).json(),
    ).toEqual({ items: [], nextCursor: null });
  });

  it('never silently changes operation target, dirty draft, field or source identity', async () => {
    const production = await insertProduction();
    const socket = await start();
    const operation: AgentOperation = {
      kind: 'production.patch',
      id: 'scoped',
      commandId: command.id,
      productionId: production.id,
      version: 1,
      changes: { title: 'Title' },
    };
    await expect(executeOperation(env, executor(socket), identity(socket), operation)).rejects.toThrow(
      '范围',
    );
    const scope = {
      ...context,
      productionId: production.id,
      field: { productionId: production.id, field: 'title' as const },
    };
    await enqueue(env.DB, { ...command, id: 'dirty', context: scope }, human);
    await expect(
      executeOperation(env, executor(socket), identity(socket), { ...operation, commandId: 'dirty' }),
    ).rejects.toThrow('人工保存');
    await enqueue(env.DB, { ...command, id: 'field', context: { ...scope, seq: 2, draft: null } }, human);
    expect(
      await executeOperation(env, executor(socket), identity(socket), {
        ...operation,
        commandId: 'dirty',
        id: 'other-field',
        changes: { intent: 'Different field' },
      }),
    ).toMatchObject({ ok: true });
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        kind: 'production.create',
        id: 'other-production',
        commandId: 'field',
        brief,
      }),
    ).rejects.toThrow('其他制作');
    expect(
      await executeOperation(env, executor(socket), identity(socket), {
        ...operation,
        commandId: 'field',
        version: 2,
      }),
    ).toMatchObject({ ok: true });
    const source = production.sources[0];
    await enqueue(
      env.DB,
      {
        ...command,
        id: 'source',
        context: {
          ...scope,
          seq: 3,
          draft: { revision: 1, value: 'Unsaved source', baseValue: source.content },
          sourceId: source.id,
          field: { productionId: production.id, field: 'source.content', sourceId: source.id },
        },
      },
      human,
    );
    const sourceOperation = { ...operation, id: 'source-op', commandId: 'source', version: 3 };
    for (const changes of [{ sources: [] }, { sources: [{ ...source, content: 'Replaced dirty content' }] }])
      await expect(
        executeOperation(env, executor(socket), identity(socket), { ...sourceOperation, changes }),
      ).rejects.toThrow('人工保存');
    expect(
      await executeOperation(env, executor(socket), identity(socket), {
        ...sourceOperation,
        changes: {
          sources: [
            { ...source, title: 'Updated title' },
            { ...source, id: 'new-source', content: 'Additional source' },
          ],
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await executeOperation(env, executor(socket), identity(socket), {
        kind: 'production.action',
        id: 'submit-focused',
        commandId: 'field',
        productionId: production.id,
        version: 4,
        action: 'submit_brief',
      }),
    ).toMatchObject({ ok: true });
    await expect(
      saveContext(env.DB, { ...context, field: { productionId: 'other', field: 'title' } }),
    ).rejects.toThrow('引用');
    await expect(
      saveContext(env.DB, { ...context, field: { productionId: 'p1', field: 'source.title' } }),
    ).rejects.toThrow('引用');
  });

  it('requires explicit audio generation rather than inferred intent or a negative/preview instruction', async () => {
    const production = await insertProduction(readyFixture({ stage: 'production', audioJob: null }));
    const focused = {
      ...context,
      productionId: production.id,
      field: { productionId: production.id, field: 'intent' as const },
    };
    const socket = await start(focused);
    const audioEnv = {
      ...env,
      AGENT_HUB: {
        getByName: () => ({
          fetch: async () =>
            Response.json({
              version: '0'.repeat(64),
              settings: defaultSpeechSettings,
              providers: { gemini: true, elevenlabs: true, raven: true, decision: true },
              coordinator: { provider: 'raven', model: 'gpt-6-astra', thinkingLevel: 'high' },
              executor: { provider: 'raven', model: 'gpt-6.1-sol', thinkingLevels: ['low'] },
              decision: { model: 'jev-latest', maxInputBytes: 16384, maxBatchQuestions: 12 },
            }),
        }),
      },
    } as unknown as Env;
    for (const [index, text] of [
      'Improve this',
      '不要生成音频',
      'Generate audio preview',
      "Don't generate audio",
    ].entries()) {
      const id = `no-audio-${index}`;
      await enqueue(env.DB, { ...command, id, text, context: focused }, human);
      await expect(
        executeOperation(audioEnv, executor(socket), identity(socket), {
          kind: 'audio.request',
          id,
          commandId: id,
          productionId: production.id,
          version: 1,
          options: {},
        }),
      ).rejects.toThrow('明确');
    }
    await enqueue(env.DB, { ...command, id: 'explicit-audio', text: '请生成音频', context: focused }, human);
    expect(
      await executeOperation(audioEnv, executor(socket), identity(socket), {
        kind: 'audio.request',
        id: 'explicit-audio',
        commandId: 'explicit-audio',
        productionId: production.id,
        version: 1,
        options: {},
      }),
    ).toMatchObject({ ok: true });
  });

  it('preserves confirmed mutation responses when live notifications fail', async () => {
    const failedEnv = {
      ...env,
      AGENT_HUB: { getByName: () => ({ fetch: () => Promise.reject(new Error('offline')) }) },
    } as unknown as Env;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      notifyProductionChanged(failedEnv, Response.json({ production: { id: 'p1', version: 1 } })),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('keeps cancellation durable across reconnect and forbids cancelling task writes and status regression', async () => {
    const production = await insertProduction();
    const socket = await start({ ...context, productionId: production.id, field: null });
    const browser = await connect('browser');
    await frame(browser, { type: 'cancel', commandId: command.id });
    const waiting = {
      type: 'command.state',
      id: 'cancel-waiting',
      commandId: command.id,
      status: 'waiting',
      detail: 'Waiting for executors to stop',
    };
    await frame(socket, waiting);
    expect(socket.frames.at(-1)).toEqual({ type: 'event.ack', id: waiting.id });
    expect(await requireCommand(env.DB, command.id)).toEqual({ status: 'cancelling' });
    expect(browser.frames.at(-1)).toEqual({ ...waiting, status: 'cancelling' });
    await frame(socket, waiting);
    expect(socket.frames.at(-1)).toEqual({ type: 'event.ack', id: waiting.id });
    expect((await runtimeSnapshot(env.DB, true)).commands).toContainEqual({
      id: command.id,
      status: 'cancelling',
      detail: waiting.detail,
    });
    await frame(socket, {
      type: 'command.state',
      id: 'late-progress',
      commandId: command.id,
      status: 'working',
      detail: '',
    });
    expect(socket.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_409' });
    const operation: AgentOperation = {
      kind: 'production.patch',
      id: 'cancelled-write',
      commandId: command.id,
      productionId: production.id,
      version: 1,
      changes: { title: 'Late edit' },
    };
    await expect(executeOperation(env, executor(socket), identity(socket), operation)).rejects.toThrow(
      'not active',
    );
    expect((await getProduction(env.DB, production.id)).version).toBe(1);
  });

  it('persists scoped operation failures before returning their ID-specific receipt', async () => {
    const socket = await start();
    const operation: AgentOperation = {
      kind: 'production.patch',
      id: 'denied',
      commandId: command.id,
      productionId: 'other',
      version: 1,
      changes: { title: 'No' },
    };
    await frame(socket, { type: 'operation', operation });
    expect(socket.frames.at(-1)).toMatchObject({
      type: 'operation.result',
      id: operation.id,
      ok: false,
      status: 403,
    });
    expect(await readReceipt(env.DB, operation.id, human)).toEqual(socket.frames.at(-1));
    await frame(socket, { type: 'operation', operation });
    expect(socket.frames.at(-1)).toMatchObject({
      type: 'operation.result',
      id: operation.id,
      ok: false,
      status: 403,
    });
    expect(
      await persistOperationFailure(
        env.DB,
        { ...operation, id: 'unknown-command', commandId: 'missing' },
        new HttpError(404, 'Not found'),
      ),
    ).toMatchObject({ ok: false, status: 404 });
    await expect(readReceipt(env.DB, 'unknown-command', human)).rejects.toThrow('不存在');
  });

  it('keeps heartbeat expiry retryable and denies duplicate D1 lease or expired handshake', async () => {
    await enroll();
    await env.DB.prepare("UPDATE agent_station SET generation = 'other', lease_until = ?")
      .bind(Date.now() + 60000)
      .run();
    expect((await connectRuntime(machine(), env)).status).toBe(409);
    await env.DB.prepare('UPDATE agent_station SET lease_until = 0').run();
    const socket = await connect();
    const attachment = socket.attachment as ConnectionIdentity;
    socket.serializeAttachment({ ...attachment, lastSeen: Date.now() - 35001 });
    await frame(socket, { type: 'ping' });
    expect(socket.close).toHaveBeenCalledWith(1013, expect.any(String));
    const expired = { ...attachment, expiresAt: Date.now() - 1 };
    expect(
      (
        await hub.fetch(
          new Request('https://hub/connect', { headers: { 'X-Hisfm-Identity': JSON.stringify(expired) } }),
        )
      ).status,
    ).toBe(401);
    const browser = await connect('browser');
    await frame(browser, { type: 'context', context });
    await frame(browser, { type: 'context', context });
    await frame(browser, { type: 'command', ...command });
    await frame(browser, { type: 'command', ...command });
    const active = await connect();
    await frame(active, {
      type: 'command.state',
      id: 'finished',
      commandId: command.id,
      status: 'complete',
      detail: '',
    });
    await frame(browser, { type: 'cancel', commandId: command.id });
    expect(await requireCommand(env.DB, command.id)).toEqual({ status: 'complete' });
    const closed = new FakeSocket();
    closed.serializeAttachment(browser.attachment);
    closed.readyState = 3;
    await frame(closed, { type: 'ping' });
    expect(closed.frames).toEqual([]);
  });

  it('authenticates cross-site rejection and production browser expiry without storing assertion secrets', async () => {
    const productionEnv = { ...env, ENVIRONMENT: 'production' };
    const assertion = `${Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 40 })).toString('base64url')}.signature`;
    const response = await connectRuntime(
      new Request('https://his.fm/admin/api/agent/live', {
        headers: { Origin: 'https://his.fm', Upgrade: 'websocket', 'Cf-Access-Jwt-Assertion': assertion },
      }),
      productionEnv,
      human,
    );
    expect(response.status).toBe(101);
    const browser = sockets.at(-1) as FakeSocket;
    expect((browser.attachment as ConnectionIdentity).sessionHash).toBeNull();
    expect(JSON.stringify(browser.attachment)).not.toContain(assertion);
    await frame(browser, { type: 'ping' });
    expect(browser.frames.at(-1)).toEqual({ type: 'pong' });
    const forbiddenHeaders: Record<string, string>[] = [
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'https://evil.example' },
    ];
    for (const headers of forbiddenHeaders) {
      expect(() =>
        requireRuntimeOrigin(new Request(`${origin}/admin/api/agent/snapshot`, { headers }), env, true),
      ).toThrow('本站');
    }
    expect(() =>
      requireRuntimeOrigin(new Request(`${origin}/admin/api/agent/snapshot`), env, true),
    ).not.toThrow();
  });
});

describe('scoped runtime delegation', () => {
  it('keeps direct controller calls unfenced and rejects mismatched authenticated executors', async () => {
    expect(operationFence(env.DB)).toEqual([]);
    expect(operationReceipt(env.DB, fixture())).toEqual([]);
    const socket = await start();
    const other = await issuePrincipal();
    const operation: AgentOperation = {
      kind: 'production.create',
      id: 'wrong-executor',
      commandId: command.id,
      brief,
    };
    await expect(executeOperation(env, other, identity(socket), operation)).rejects.toThrow(
      'identity mismatch',
    );
    await expect(executeOperation(env, human, identity(socket), operation)).rejects.toThrow(
      'identity mismatch',
    );
    socket.serializeAttachment({
      ...(socket.attachment as ConnectionIdentity),
      actor: { ...executor(socket), scopes: [] },
    });
    await hub.alarm();
    expect(socket.close).toHaveBeenCalledWith(4001, expect.any(String));
  });

  it('preserves committed receipts after a controller delivery failure and reports genuine routing failures', async () => {
    const socket = await start();
    const operation: AgentOperation = {
      kind: 'production.create',
      id: 'lost-response',
      commandId: command.id,
      brief,
    };
    const original = productionRoutes.routeProductions;
    const route = vi.spyOn(productionRoutes, 'routeProductions').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new HttpError(503, 'Delivery failed after commit');
    });
    expect(await executeOperation(env, executor(socket), identity(socket), operation)).toMatchObject({
      ok: true,
      status: 201,
    });
    route.mockImplementationOnce(async () => {
      throw new Error('Database unavailable');
    });
    await expect(
      executeOperation(env, executor(socket), identity(socket), { ...operation, id: 'storage-failure' }),
    ).rejects.toThrow('Database unavailable');
    route.mockResolvedValueOnce(null);
    expect(
      await executeOperation(env, executor(socket), identity(socket), { ...operation, id: 'route-missing' }),
    ).toMatchObject({ ok: false, status: 404 });
    route.mockRestore();
  });

  it('skips legacy commands on reconnect and does not let dirty source restrictions block unrelated edits', async () => {
    await enqueue(env.DB, { ...command, id: 'legacy-command', context: null }, human);
    await env.DB.prepare(
      "UPDATE agent_commands SET data = json_remove(data, '$.principal') WHERE id = 'legacy-command'",
    ).run();
    const production = await getProduction(env.DB, 'p1');
    const source = production.sources[0];
    const sourceContext: PageContext = {
      ...context,
      sourceId: source.id,
      field: { productionId: 'p1', field: 'source.content', sourceId: source.id },
      draft: { revision: 1, value: 'Unsaved', baseValue: source.content },
    };
    const socket = await start(sourceContext);
    expect(socket.frames).not.toContainEqual(
      expect.objectContaining({
        type: 'command',
        command: expect.objectContaining({ id: 'legacy-command' }),
      }),
    );
    const operation: AgentOperation = {
      kind: 'production.patch',
      id: 'source-unrelated',
      commandId: command.id,
      productionId: 'p1',
      version: 1,
      changes: { intent: 'An unrelated edit' },
    };
    expect(await executeOperation(env, executor(socket), identity(socket), operation)).toMatchObject({
      ok: true,
    });
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...operation,
        id: 'invalid-sources',
        version: 2,
        changes: { sources: 'invalid' },
      }),
    ).rejects.toThrow('人工保存');
    await persistEvent(env.DB, {
      type: 'message',
      message: {
        id: 'ambient-reply',
        role: 'assistant',
        text: 'Coordinator ready',
        commandId: null,
        createdAt: new Date().toISOString(),
      },
    });
    await env.DB.prepare("UPDATE agent_commands SET status = 'cancelling' WHERE id = ?")
      .bind(command.id)
      .run();
    await expect(
      persistEvent(env.DB, {
        type: 'proposal',
        proposal: {
          id: 'late-proposal',
          commandId: command.id,
          context: sourceContext,
          target: sourceContext.field as NonNullable<PageContext['field']>,
          value: 'Too late',
          summary: 'Late',
        },
      }),
    ).rejects.toThrow('正在取消');
  });

  it('bounds proposal-only snapshots and marks production speech failures without disturbing other work', async () => {
    const proposal = {
      id: 'proposal',
      commandId: 'proposal-command',
      context,
      target: context.field,
      value: 'x'.repeat(30000),
      summary: 'Draft',
    };
    await env.DB.batch(
      Array.from({ length: 12 }, (_, index) =>
        env.DB.prepare('INSERT INTO agent_proposals (id, data) VALUES (?, ?)').bind(
          `proposal-${index}`,
          JSON.stringify({ ...proposal, id: `proposal-${index}` }),
        ),
      ),
    );
    const snapshot = await runtimeSnapshot(env.DB, false);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.proposals.length).toBeLessThan(12);
    const input = {
      provider: 'gemini' as const,
      model: 'gemini-3.8-flash-tts',
      voice: 'Kore',
      speakingStyle: 'calm',
      text: '你好',
      stability: 0.5,
      similarity: 0.75,
    };
    for (const [id, terminal] of [
      ['invalid-production', false],
      ['ended-production', true],
    ] as const) {
      const base = readyFixture({ stage: 'production' });
      await insertProduction({
        ...base,
        id,
        audioJob: { id, status: 'queued', scriptVersion: 1, createdAt: '', error: null },
      });
      await env.DB.prepare(
        "INSERT INTO audio_jobs (id, production_id, snapshot, status, created_at, updated_at) VALUES (?, ?, ?, 'running', '', '')",
      )
        .bind(
          id,
          id,
          JSON.stringify({ jobId: id, productionId: id, scriptVersion: 1, speech: input, principal: human }),
        )
        .run();
      await queueSpeech(env, id, 'production', input, id, human);
      await env.DB.prepare(
        terminal
          ? "UPDATE agent_commands SET status = 'failed' WHERE id IN (SELECT command_id FROM speech_jobs WHERE id = ?)"
          : "UPDATE agent_commands SET data = json_remove(data, '$.principal') WHERE id IN (SELECT command_id FROM speech_jobs WHERE id = ?)",
      )
        .bind(id)
        .run();
    }
    await hub.alarm();
    for (const id of ['invalid-production', 'ended-production']) {
      expect(
        await env.DB.prepare('SELECT status FROM speech_jobs WHERE id = ?').bind(id).first('status'),
      ).toBe('failed');
      expect((await getProduction(env.DB, id)).audioJob?.status).toBe('failed');
    }
  });

  it('requires explicit runtime grants, limits global history and never accepts an agent as a browser', async () => {
    const actor = await issuePrincipal(['runtime:manage']);
    await expect(connectRuntime(request('/admin/api/agent/live'), env, actor)).rejects.toMatchObject({
      status: 403,
    });
    for (const path of ['/admin/api/agent/history', '/admin/api/agent/snapshot'])
      await expect(routeRuntimeAdmin(new Request(`${origin}${path}`), env, actor)).rejects.toThrow(
        'tasks:manage',
      );
    await expect(routeRuntimeAdmin(request('/admin/api/agent/station'), env, agent)).rejects.toThrow(
      'runtime:manage',
    );
    await enroll();
    await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind(JSON.stringify(['productions:read']), tokenId)
      .run();
    await expect(connectRuntime(machine(), env)).rejects.toThrow('runtime:connect');
    await expect(routeRuntimeReceipt(machine('/api/agent/runtime/receipts/none'), env)).rejects.toThrow(
      'runtime:connect',
    );
    await expect(enroll(1)).rejects.toThrow('runtime:connect');
    const browser = await connect('browser');
    const forged = { ...(browser.attachment as ConnectionIdentity), actor };
    expect(
      (
        await hub.fetch(
          new Request('https://hub/connect', { headers: { 'X-Hisfm-Identity': JSON.stringify(forged) } }),
        )
      ).status,
    ).toBe(403);
    browser.serializeAttachment(forged);
    await hub.alarm();
    expect(browser.close).toHaveBeenCalledWith(4001, expect.any(String));
  });

  it('bounds station binding by target scope and expiry, and prunes removed runtime grants', async () => {
    const weak = await issuePrincipal(['runtime:manage', 'runtime:connect']);
    const binding = () =>
      new Request(`${origin}/admin/api/agent/station`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId, stationId: 'station1' }),
      });
    await expect(routeRuntimeAdmin(binding(), env, weak)).rejects.toThrow('manager grants');
    const strong = await issuePrincipal();
    await expect(
      routeRuntimeAdmin(binding(), env, { ...strong, expiresAt: Date.now() + 1000 }),
    ).rejects.toThrow('expiry');
    expect((await routeRuntimeAdmin(binding(), env, strong)).status).toBe(200);
    const socket = await connect();
    await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind(JSON.stringify(['productions:read']), tokenId)
      .run();
    await hub.alarm();
    expect(socket.close).toHaveBeenCalledWith(4001, expect.any(String));
    expect((await station(env.DB))?.generation).toBeNull();
  });

  it('persists only trusted task principals from REST and browser submissions and cancels through the shared handler', async () => {
    const actor = await issuePrincipal(['tasks:submit', 'tasks:manage', 'prompts:read', 'productions:read']);
    const internal = (path: string, body: unknown, method = 'POST') =>
      new Request(`https://hub${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      });
    const input = { ...command, id: 'rest-task' };
    const first = await hub.fetch(internal('/task', { input, principal: actor }));
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ inserted: true, command: { principal: actor } });
    expect((await hub.fetch(internal('/task', { input, principal: actor }))).status).toBe(200);
    await expect(
      hub.fetch(internal('/task', { input: { ...input, principal: human }, principal: actor })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(hub.fetch(internal('/task', { input }))).rejects.toMatchObject({ status: 400 });
    await expect(hub.fetch(internal('/task', {}, 'GET'))).rejects.toMatchObject({ status: 405 });
    await expect(hub.fetch(internal('/task-cancel', {}, 'GET'))).rejects.toMatchObject({ status: 405 });
    await expect(
      enqueue(env.DB, { ...input, id: 'missing-origin' }, undefined as unknown as Principal),
    ).rejects.toThrow('originator');
    const noSubmit = await issuePrincipal(['productions:read']);
    await expect(enqueue(env.DB, input, noSubmit)).rejects.toThrow('tasks:submit');
    const submitOnly = await issuePrincipal(['tasks:submit']);
    await expect(enqueue(env.DB, { ...input, id: 'submit-only', context: null }, submitOnly)).rejects.toThrow(
      'tasks:manage',
    );
    const noPrompts = await issuePrincipal(['tasks:submit', 'tasks:manage']);
    await expect(enqueue(env.DB, { ...input, id: 'no-prompts', context: null }, noPrompts)).rejects.toThrow(
      'prompts:read',
    );
    expect(
      await env.DB.prepare("SELECT id FROM agent_commands WHERE id IN ('submit-only', 'no-prompts')").all(),
    ).toMatchObject({ results: [] });
    const noRead = await issuePrincipal(['tasks:submit', 'tasks:manage', 'prompts:read']);
    await expect(enqueue(env.DB, input, noRead)).rejects.toThrow('productions:read');
    expect(await (await hub.fetch(internal('/task-cancel', { id: input.id }))).json()).toMatchObject({
      cancelling: true,
    });
    expect((await requireCommand(env.DB, input.id)).status).toBe('cancelling');
    const browser = await connect('browser');
    await frame(browser, { type: 'command', ...command });
    const saved = await env.DB.prepare('SELECT data FROM agent_commands WHERE id = ?')
      .bind(command.id)
      .first<string>('data');
    expect(JSON.parse(saved ?? '{}').principal).toEqual(human);
    await frame(browser, { type: 'command', ...command, id: 'forged', principal: actor });
    expect(browser.frames.at(-1)).toMatchObject({ type: 'error', code: 'http_400' });
  });

  it('intersects current executor and originator grants without upgrading the captured ceiling', async () => {
    const socket = await start({ ...context, field: null });
    const limited = await issuePrincipal([
      'tasks:submit',
      'tasks:manage',
      'prompts:read',
      'productions:read',
    ]);
    await enqueue(env.DB, { ...command, id: 'limited', context: { ...context, field: null } }, limited);
    await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind(JSON.stringify(scopePresets.owner), limited.tokenId)
      .run();
    const patch: AgentOperation = {
      kind: 'production.patch',
      id: 'limited-write',
      commandId: 'limited',
      productionId: 'p1',
      version: 1,
      changes: { title: 'No upgrade' },
    };
    expect(await executeOperation(env, executor(socket), identity(socket), patch)).toMatchObject({
      ok: false,
      status: 403,
    });
    const origin = await issuePrincipal([
      'tasks:submit',
      'tasks:manage',
      'prompts:read',
      'productions:read',
      'productions:write',
    ]);
    await enqueue(env.DB, { ...command, id: 'writer', context: { ...context, field: null } }, origin);
    await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind(JSON.stringify(['runtime:connect', 'productions:read']), tokenId)
      .run();
    expect(
      await executeOperation(env, executor(socket), identity(socket), {
        ...patch,
        id: 'executor-shrink',
        commandId: 'writer',
      }),
    ).toMatchObject({ ok: false, status: 403 });
    expect((await getProduction(env.DB, 'p1')).version).toBe(1);
    await expect(
      executeOperation(env, { ...executor(socket), tokenId: 'wrong' }, identity(socket), {
        ...patch,
        id: 'wrong-executor',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await env.DB.prepare("UPDATE agent_commands SET data = json_remove(data, '$.principal') WHERE id = ?")
      .bind('writer')
      .run();
    await expect(
      executeOperation(env, executor(socket), identity(socket), {
        ...patch,
        id: 'legacy',
        commandId: 'writer',
      }),
    ).rejects.toThrow('originator');
  });

  it.each([
    ['origin revoked', null],
    ['origin grants removed', 'productions:write'],
    ['origin task management removed', 'tasks:manage'],
    ['origin prompt access removed', 'prompts:read'],
    ['contextual origin read removed', 'productions:read'],
    ['origin expired', null],
    ['executor grants removed', null],
    ['captured principal replaced', null],
  ] as const)(
    'atomically fences a concurrent %s before any production effect',
    async (change, removedScope) => {
      const socket = await start({ ...context, field: null });
      expect(executor(socket).scopes).not.toContain('tasks:manage');
      const origin = await issuePrincipal([
        'tasks:submit',
        'tasks:manage',
        'prompts:read',
        'productions:read',
        'productions:write',
      ]);
      await enqueue(env.DB, { ...command, id: 'raced-origin', context: { ...context, field: null } }, origin);
      if (removedScope === 'productions:read')
        await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
          .bind(
            JSON.stringify(scopePresets.coordinator.filter((scope) => scope !== 'productions:read')),
            tokenId,
          )
          .run();
      const raced = new Proxy(env.DB, {
        get(target, property) {
          if (property === 'batch')
            return async (statements: D1PreparedStatement[]) => {
              if (change === 'origin revoked')
                await target
                  .prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ?')
                  .bind(new Date().toISOString(), origin.tokenId)
                  .run();
              else if (change === 'origin expired')
                await target
                  .prepare("UPDATE agent_tokens SET expires_at = '2000-01-01' WHERE id = ?")
                  .bind(origin.tokenId)
                  .run();
              else if (change === 'captured principal replaced')
                await target
                  .prepare(
                    "UPDATE agent_commands SET data = json_set(data, '$.principal', json(?)) WHERE id = 'raced-origin'",
                  )
                  .bind(JSON.stringify(human))
                  .run();
              else if (removedScope)
                await target
                  .prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
                  .bind(
                    JSON.stringify(origin.scopes?.filter((scope) => scope !== removedScope)),
                    origin.tokenId,
                  )
                  .run();
              else
                await target
                  .prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
                  .bind(JSON.stringify(['runtime:connect', 'productions:read']), tokenId)
                  .run();
              return target.batch(statements);
            };
          return Reflect.get(target, property);
        },
      });
      await expect(
        executeOperation({ ...env, DB: raced }, executor(socket), identity(socket), {
          kind: 'production.patch',
          id: 'raced-write',
          commandId: 'raced-origin',
          productionId: 'p1',
          version: 1,
          changes: { title: 'Never commit' },
        }),
      ).rejects.toThrow('租约');
      expect((await getProduction(env.DB, 'p1')).version).toBe(1);
      expect(
        await env.DB.prepare("SELECT response FROM agent_receipts WHERE id = 'raced-write'").first(
          'response',
        ),
      ).toBeNull();
    },
  );

  it('replays terminal receipts without triggering audio, redacts private publications and validates live origins', async () => {
    await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind(JSON.stringify(scopePresets.owner), tokenId)
      .run();
    const socket = await start({ ...context, field: null });
    const origin = await issuePrincipal();
    await enqueue(env.DB, { ...command, id: 'receipt-origin', context: { ...context, field: null } }, origin);
    const operation: AgentOperation = {
      kind: 'audio.request',
      id: 'replay-audio',
      commandId: 'receipt-origin',
      productionId: 'p1',
      version: 1,
      options: {},
    };
    const production = readyFixture({
      id: 'p1',
      publications: [
        {
          platform: 'wechat',
          url: 'https://mp.weixin.qq.com/s/private-audit',
          publishedAt: '',
          confirmedAt: '',
          confirmedBy: 'Owner',
          version: 1,
        },
      ],
      events: [
        {
          id: 'publication-audit',
          at: '',
          actor: human,
          action: 'record_publication:wechat',
          feedback: 'private-audit',
        },
      ],
    });
    const receipt = {
      type: 'operation.result',
      id: operation.id,
      ok: true,
      status: 202,
      result: { production },
    };
    await env.DB.prepare('INSERT INTO agent_receipts (id, hash, command_id, response) VALUES (?, ?, ?, ?)')
      .bind(operation.id, await digest(operation), operation.commandId, JSON.stringify(receipt))
      .run();
    const trigger = vi.spyOn(audioRoutes, 'triggerAudio').mockResolvedValue(undefined);
    for (const status of ['complete', 'failed', 'cancelled', 'cancelling']) {
      await env.DB.prepare('UPDATE agent_commands SET status = ? WHERE id = ?')
        .bind(status, operation.commandId)
        .run();
      expect(await executeOperation(env, executor(socket), identity(socket), operation)).toEqual(receipt);
    }
    expect(trigger).not.toHaveBeenCalled();
    trigger.mockRestore();
    await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind(
        JSON.stringify(scopePresets.owner.filter((scope) => scope !== 'publications:read')),
        origin.tokenId,
      )
      .run();
    const redacted = await readReceipt(env.DB, operation.id, executor(socket));
    expect(JSON.stringify(redacted)).not.toContain('private-audit');
    await env.DB.prepare('UPDATE agent_tokens SET scopes = ? WHERE id = ?')
      .bind(JSON.stringify(['tasks:submit', 'tasks:manage', 'prompts:read']), origin.tokenId)
      .run();
    expect(await readReceipt(env.DB, operation.id, executor(socket))).toMatchObject({
      result: { production: { id: 'p1', version: 1 } },
    });
    expect(
      Object.keys((await readReceipt(env.DB, operation.id, executor(socket)))?.result as object),
    ).toEqual(['production']);
    await env.DB.prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), origin.tokenId)
      .run();
    await expect(readReceipt(env.DB, operation.id, executor(socket))).rejects.toThrow('no longer valid');
    await expect(executeOperation(env, executor(socket), identity(socket), operation)).rejects.toThrow(
      'no longer valid',
    );
  });

  it('keeps write-only durable receipts minimal even if a later executor has broader read access', async () => {
    const socket = await start();
    const origin = await issuePrincipal([
      'tasks:submit',
      'tasks:manage',
      'prompts:read',
      'productions:write',
    ]);
    await enqueue(env.DB, { ...command, id: 'write-only', context: null }, origin);
    const operation: AgentOperation = {
      kind: 'production.create',
      id: 'write-only-op',
      commandId: 'write-only',
      brief,
    };
    const receipt = await executeOperation(env, executor(socket), identity(socket), operation);
    expect(receipt.ok).toBe(true);
    const value = receipt.result as { production: { id: string; version: number } };
    expect(Object.keys(value.production).sort()).toEqual(['id', 'version']);
    expect(await readReceipt(env.DB, operation.id, human)).toEqual(receipt);
    expect((await getProduction(env.DB, value.production.id)).title).toBe(brief.title);
    expect(operationOrigin()).toBeUndefined();
  });

  it('carries the original task principal into audio snapshots rather than borrowing the station token', async () => {
    const production = await insertProduction(readyFixture({ stage: 'production', audioJob: null }));
    const socket = await start();
    expect(executor(socket).scopes).not.toContain('tasks:manage');
    const origin = await issuePrincipal([
      'tasks:submit',
      'tasks:manage',
      'prompts:read',
      'productions:read',
      'audio:generate',
    ]);
    await enqueue(
      env.DB,
      {
        ...command,
        id: 'origin-audio',
        text: '请生成音频',
        context: { ...context, productionId: production.id, field: null },
      },
      origin,
    );
    const audioEnv = {
      ...env,
      AGENT_HUB: {
        getByName: () => ({
          fetch: async () =>
            Response.json({
              version: '0'.repeat(64),
              settings: defaultSpeechSettings,
              providers: { gemini: true, elevenlabs: true, raven: true, decision: true },
              coordinator: { provider: 'raven', model: 'gpt-6-astra', thinkingLevel: 'high' },
              executor: { provider: 'raven', model: 'gpt-6.1-sol', thinkingLevels: ['low'] },
              decision: { model: 'jev-latest', maxInputBytes: 16384, maxBatchQuestions: 12 },
            }),
        }),
      },
    } as unknown as Env;
    expect(
      await executeOperation(audioEnv, executor(socket), identity(socket), {
        kind: 'audio.request',
        id: 'audio-origin-op',
        commandId: 'origin-audio',
        productionId: production.id,
        version: 1,
        options: {},
      }),
    ).toMatchObject({ ok: true });
    const snapshot = await env.DB.prepare('SELECT snapshot FROM audio_jobs WHERE production_id = ?')
      .bind(production.id)
      .first<string>('snapshot');
    expect(JSON.parse(snapshot ?? '{}').principal).toEqual(origin);
    expect(JSON.parse(snapshot ?? '{}').principal.tokenId).not.toBe(tokenId);
    expect(operationOrigin()).toBeUndefined();
  });

  it('isolates legacy speech jobs and invalid queued audio instead of blocking valid later work', async () => {
    const socket = await start();
    const input = {
      provider: 'gemini' as const,
      model: 'gemini-3.8-flash-tts',
      voice: 'Kore',
      speakingStyle: 'calm',
      text: '你好',
      stability: 0.5,
      similarity: 0.75,
    };
    await queueSpeech(env, 'legacy-preview', 'preview', input, null, human);
    await env.DB.prepare(
      "UPDATE agent_commands SET data = json_remove(data, '$.principal') WHERE id IN (SELECT command_id FROM speech_jobs WHERE id = 'legacy-preview')",
    ).run();
    await queueSpeech(env, 'valid-preview', 'preview', input, null, human);
    await hub.fetch(new Request('https://hub/speech-queued'));
    expect(
      await env.DB.prepare("SELECT status FROM speech_jobs WHERE id = 'legacy-preview'").first('status'),
    ).toBe('failed');
    expect(socket.frames).toContainEqual(
      expect.objectContaining({
        type: 'command',
        command: expect.objectContaining({ id: expect.stringContaining('speech:valid-preview:') }),
      }),
    );
    const base = readyFixture({ stage: 'production' });
    await insertProduction({
      ...base,
      id: 'legacy-audio',
      audioJob: { id: 'legacy-audio', status: 'queued', scriptVersion: 1, createdAt: '', error: null },
    });
    await env.DB.prepare(
      "INSERT INTO audio_jobs (id, production_id, snapshot, status, created_at, updated_at) VALUES ('legacy-audio', 'legacy-audio', ?, 'queued', '', '')",
    )
      .bind(
        JSON.stringify({
          jobId: 'legacy-audio',
          productionId: 'legacy-audio',
          scriptVersion: 1,
          speech: input,
        }),
      )
      .run();
    await hub.alarm();
    expect(
      await env.DB.prepare("SELECT status FROM audio_jobs WHERE id = 'legacy-audio'").first('status'),
    ).toBe('failed');
    expect((await getProduction(env.DB, 'legacy-audio')).audioJob?.status).toBe('failed');
    expect(
      await env.DB.prepare("SELECT status FROM speech_jobs WHERE id = 'valid-preview'").first('status'),
    ).toBe('queued');
  });
});
