import { readFileSync } from 'node:fs';
import {
  type AgentOperation,
  defaultSpeechSettings,
  type PageContext,
  type ServerFrame,
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
import { executeOperation, persistOperationFailure, readReceipt } from '../../worker/agent-runtime-operation';
import {
  digest,
  enqueue,
  persistEvent,
  requireCommand,
  runtimeSnapshot,
  saveContext,
  station,
} from '../../worker/agent-runtime-store';
import { routeAgentTokens } from '../../worker/agent-tokens';
import { localLogin } from '../../worker/auth';
import { HttpError } from '../../worker/http';
import { queueSpeech } from '../../worker/native-speech';
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
  await enqueue(env.DB, { ...command, text, context: scope });
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
    request('/admin/api/agent-tokens', 'POST', { name: 'Runtime test', expiresInDays: 1 }),
    env,
    '/admin/api/agent-tokens',
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
    const saved = await enqueue(env.DB, command);
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
      enqueue(env.DB, {
        ...command,
        id: 'bad-production',
        context: { ...context, productionId: 'missing', field: null },
      }),
    ).rejects.toThrow('不存在');
    await expect(
      enqueue(env.DB, {
        ...command,
        id: 'bad-source',
        context: { ...context, sourceId: 'missing', field: null },
      }),
    ).rejects.toThrow('来源');
  });
  it('hashes canonical objects and deduplicates commands without losing their creation time', async () => {
    expect(await digest({ b: [2, 1], a: null })).toBe(await digest({ a: null, b: [2, 1] }));
    const first = await enqueue(env.DB, command);
    expect(first.inserted).toBe(true);
    expect(await enqueue(env.DB, command)).toEqual({ ...first, inserted: false });
    await expect(enqueue(env.DB, { ...command, text: 'Different' })).rejects.toThrow('ID');
    await expect(requireCommand(env.DB, 'missing')).rejects.toThrow('不存在');
    await expect(requireCommand(env.DB, command.id, true)).resolves.toEqual({ status: 'queued' });
    const longest = { ...command, id: 'x'.repeat(160), context: null };
    await enqueue(env.DB, longest);
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
    await enqueue(env.DB, command);
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
    const receipt = await readReceipt(env.DB, operation.id);
    expect(receipt).toMatchObject({ ok: true, status: 201 });
    if (!receipt) throw new Error('Missing committed receipt');
    const production = (receipt.result as { production: ReturnType<typeof fixture> }).production;
    expect(production.events[0].actor.kind).toBe('agent');
    expect(browser.frames.at(-1)).toEqual({
      type: 'production.changed',
      productionId: production.id,
      version: 1,
    });
    expect(await executeOperation(env, agent, identity(socket), operation)).toEqual(receipt);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM productions').first('count')).toBe(2);
    await expect(
      executeOperation(env, agent, identity(socket), { ...operation, brief: { ...brief, title: 'other' } }),
    ).rejects.toThrow('ID');
    expect(
      await (await routeRuntimeReceipt(machine(`/api/agent/runtime/receipts/${operation.id}`), env)).json(),
    ).toEqual({ receipt });
    await expect(readReceipt(env.DB, 'missing')).rejects.toThrow('不存在');
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
    expect(await executeOperation(env, agent, identity(socket), operation)).toMatchObject({
      ok: true,
      result: { production: { title: 'Changed', version: 2 } },
    });
    expect(await executeOperation(env, agent, identity(socket), { ...operation, id: 'stale' })).toMatchObject(
      { ok: false, status: 409 },
    );
    expect(
      await executeOperation(env, agent, identity(socket), {
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
    const created = await executeOperation(env, agent, identity(socket), {
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
    expect(await executeOperation(env, agent, identity(socket), patch)).toMatchObject({
      ok: true,
      result: { production: { version: 2 } },
    });
    expect(
      await executeOperation(env, agent, identity(socket), {
        kind: 'production.action',
        id: 'submit-owned',
        commandId: command.id,
        productionId: production.id,
        version: 2,
        action: 'submit_brief',
      }),
    ).toMatchObject({ ok: true, result: { production: { stage: 'brief_review' } } });
    await expect(
      executeOperation(env, agent, identity(socket), {
        ...patch,
        id: 'arbitrary-production',
        productionId: 'p1',
      }),
    ).rejects.toThrow('范围');
    await enqueue(env.DB, { ...command, id: 'other-command', context: null });
    await expect(
      executeOperation(env, agent, identity(socket), {
        ...patch,
        id: 'other-command-write',
        commandId: 'other-command',
        version: 3,
      }),
    ).rejects.toThrow('范围');
    await enqueue(env.DB, { ...command, id: 'page-command', context: { ...context, field: null } });
    await expect(
      executeOperation(env, agent, identity(socket), {
        ...patch,
        id: 'wrong-page-write',
        commandId: 'page-command',
        version: 3,
      }),
    ).rejects.toThrow('范围');
    await env.DB.prepare('UPDATE agent_receipts SET response = NULL WHERE id = ?').bind('create-owned').run();
    await expect(
      executeOperation(env, agent, identity(socket), { ...patch, id: 'pending-create', version: 3 }),
    ).rejects.toThrow('范围');
    await env.DB.prepare('UPDATE agent_receipts SET response = ? WHERE id = ?')
      .bind(JSON.stringify({ ...created, ok: false }), 'create-owned')
      .run();
    await expect(
      executeOperation(env, agent, identity(socket), { ...patch, id: 'failed-create', version: 3 }),
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
    await expect(executeOperation(env, agent, identity(socket), operation)).rejects.toThrow('租约');
    expect(await readReceipt(env.DB, operation.id)).toBeNull();
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
    expect(await executeOperation({ ...env, DB: racedDb }, agent, identity(socket), operation)).toMatchObject(
      { ok: false, status: 409 },
    );
    expect(await readReceipt(env.DB, operation.id)).toMatchObject({ ok: false, status: 409 });
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
    await queueSpeech(env, 'preview', 'preview', input, null);
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
    await queueSpeech(env, 'preview', 'preview', input, null);
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
    await expect(executeOperation(env, agent, identity(socket), operation)).rejects.toThrow('范围');
    const scope = {
      ...context,
      productionId: production.id,
      field: { productionId: production.id, field: 'title' as const },
    };
    await enqueue(env.DB, { ...command, id: 'dirty', context: scope });
    await expect(
      executeOperation(env, agent, identity(socket), { ...operation, commandId: 'dirty' }),
    ).rejects.toThrow('人工保存');
    await enqueue(env.DB, { ...command, id: 'field', context: { ...scope, seq: 2, draft: null } });
    expect(
      await executeOperation(env, agent, identity(socket), {
        ...operation,
        commandId: 'dirty',
        id: 'other-field',
        changes: { intent: 'Different field' },
      }),
    ).toMatchObject({ ok: true });
    await expect(
      executeOperation(env, agent, identity(socket), {
        kind: 'production.create',
        id: 'other-production',
        commandId: 'field',
        brief,
      }),
    ).rejects.toThrow('其他制作');
    expect(
      await executeOperation(env, agent, identity(socket), { ...operation, commandId: 'field', version: 2 }),
    ).toMatchObject({ ok: true });
    const source = production.sources[0];
    await enqueue(env.DB, {
      ...command,
      id: 'source',
      context: {
        ...scope,
        seq: 3,
        draft: { revision: 1, value: 'Unsaved source', baseValue: source.content },
        sourceId: source.id,
        field: { productionId: production.id, field: 'source.content', sourceId: source.id },
      },
    });
    const sourceOperation = { ...operation, id: 'source-op', commandId: 'source', version: 3 };
    for (const changes of [{ sources: [] }, { sources: [{ ...source, content: 'Replaced dirty content' }] }])
      await expect(
        executeOperation(env, agent, identity(socket), { ...sourceOperation, changes }),
      ).rejects.toThrow('人工保存');
    expect(
      await executeOperation(env, agent, identity(socket), {
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
      await executeOperation(env, agent, identity(socket), {
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
      await enqueue(env.DB, { ...command, id, text, context: focused });
      await expect(
        executeOperation(audioEnv, agent, identity(socket), {
          kind: 'audio.request',
          id,
          commandId: id,
          productionId: production.id,
          version: 1,
          options: {},
        }),
      ).rejects.toThrow('明确');
    }
    await enqueue(env.DB, { ...command, id: 'explicit-audio', text: '请生成音频', context: focused });
    expect(
      await executeOperation(audioEnv, agent, identity(socket), {
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
    await expect(executeOperation(env, agent, identity(socket), operation)).rejects.toThrow('租约');
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
    expect(await readReceipt(env.DB, operation.id)).toEqual(socket.frames.at(-1));
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
    await expect(readReceipt(env.DB, 'unknown-command')).rejects.toThrow('不存在');
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
