import type { DraftProposal, PageContext, ServerFrame } from '@his-fm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentClient } from './service';

const context: PageContext = {
  tabId: 'tab',
  pageEpoch: 1,
  seq: 3,
  route: '/admin/productions/one',
  productionId: 'one',
  step: 'script',
  sourceId: null,
  version: 1,
  field: { productionId: 'one', field: 'transcript' },
  draft: { revision: 2, value: 'draft', baseValue: 'base' },
  selection: { from: 0, to: 5, text: 'draft' },
  activity: 'editing',
};
const proposal: DraftProposal = {
  id: 'proposal',
  commandId: 'command',
  context,
  target: { productionId: 'one', field: 'transcript' },
  value: 'improved',
  summary: 'Improve the draft',
};
const snapshot: Extract<ServerFrame, { type: 'snapshot' }> = {
  type: 'snapshot',
  online: true,
  messages: [],
  conversations: [],
  commands: [],
  proposals: [],
};

class Socket {
  readyState = 0;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close = vi.fn((code = 1006) => {
    this.readyState = 3;
    this.onclose?.({ code });
  });
  receive(frame: ServerFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}
let sockets: Socket[];
let client: AgentClient;
const latest = () => sockets[sockets.length - 1];
const connect = () => {
  client.start();
  latest().open();
  latest().receive(snapshot);
};
const setPage = (overrides: Partial<PageContext> = {}) => {
  const { route, productionId, step, sourceId, version, activity } = { ...context, ...overrides };
  client.setPage({ route, productionId, step, sourceId, version, activity });
};
const setField = (apply = vi.fn(() => true)) => {
  client.field({ field: context.field, draft: context.draft, selection: context.selection }, apply);
  return apply;
};

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  client = new AgentClient('ws://localhost/admin/api/agent/live?protocol=1', () => {
    const socket = new Socket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
});
afterEach(() => {
  client.stop();
  vi.useRealTimers();
});

describe('shell-lifetime agent transport', () => {
  it('clears untracked field scope and invalidates earlier proposals without changing page', () => {
    client.clearField();
    expect(client.context).toBeNull();
    connect();
    setPage();
    const apply = setField();
    const original = structuredClone(client.context as PageContext);
    client.clearField();
    expect(client.context).toMatchObject({
      field: null,
      draft: null,
      selection: null,
      pageEpoch: original.pageEpoch,
      seq: original.seq + 1,
    });
    const seq = client.context?.seq;
    client.clearField();
    expect(client.context?.seq).toBe(seq);
    expect(client.proposal({ ...proposal, context: original }, true)).toBe('stale');
    expect(apply).not.toHaveBeenCalled();
    setField(apply);
    expect(
      client.proposal(
        { ...proposal, id: 'new-proposal', context: structuredClone(client.context as PageContext) },
        true,
      ),
    ).toBe('applied');
    expect(apply).toHaveBeenCalledOnce();
  });
  it('uses the browser WebSocket constructor by default', () => {
    const socket = new Socket();
    vi.stubGlobal(
      'WebSocket',
      vi.fn(function WebSocketMock() {
        return socket;
      }),
    );
    const browserClient = new AgentClient('ws://localhost/admin/api/agent/live');
    browserClient.start();
    browserClient.stop();
    vi.unstubAllGlobals();
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('waits for context acknowledgement before commands and their cancellation', () => {
    connect();
    setPage();
    setField();
    client.command('frozen');
    const id = client.state.commands[0].id;
    client.cancel(id);
    expect(latest().sent.some((frame) => frame.type === 'command' || frame.type === 'cancel')).toBe(false);
    latest().receive({
      type: 'context.ack',
      tabId: client.context?.tabId ?? '',
      seq: client.context?.seq ?? 0,
    });
    expect(latest().sent.some((frame) => frame.type === 'command')).toBe(true);
    expect(latest().sent.some((frame) => frame.type === 'cancel')).toBe(false);
    latest().receive({ type: 'command.ack', id });
    expect(latest().sent.at(-1)).toEqual({ type: 'cancel', commandId: id });
  });
  it('keeps acknowledged snapshot messages and ignores proposals from another tab', () => {
    client.command('queued');
    const id = client.state.commands[0].id;
    client.start();
    latest().open();
    latest().receive({
      ...snapshot,
      messages: [{ id: `user:${id}`, role: 'user', text: 'queued', commandId: id, createdAt: 'now' }],
      proposals: [proposal],
    });
    expect(client.state.messages).toHaveLength(1);
    expect(client.state.proposals).toEqual([]);
  });
  it('acks deliveries only after reducer and event application', () => {
    connect();
    const check = client.onFrame(() => {
      expect(client.state.online).toBe(false);
      expect(latest().sent.at(-1)?.type).not.toBe('delivery.ack');
    });
    latest().receive({ type: 'presence', online: false, deliveryId: 4 });
    expect(latest().sent.at(-1)).toEqual({ type: 'delivery.ack', deliveryId: 4 });
    check();
  });
  it('waits for snapshot, replays unacknowledged immutable commands, heartbeats without drafts', () => {
    const subscriber = vi.fn();
    const frameListener = vi.fn();
    const unsubscribe = client.subscribe(subscriber);
    const off = client.onFrame(frameListener);
    client.cancel('before-connect');
    client.start();
    latest().open();
    setPage();
    setField();
    client.command(' Write this ');
    const original = structuredClone(client.context);
    setPage({ sourceId: 'different' });
    expect(latest().sent).toEqual([{ type: 'ping' }]);
    latest().receive(snapshot);
    expect(latest().sent.some((frame) => frame.type === 'command')).toBe(false);
    latest().receive({ type: 'context.ack', tabId: 'other', seq: 200 });
    latest().receive({ type: 'context.ack', tabId: client.context?.tabId ?? '', seq: 200 });
    expect(latest().sent.some((frame) => frame.type === 'command')).toBe(false);
    latest().receive({
      type: 'context.ack',
      tabId: client.context?.tabId ?? '',
      seq: client.context?.seq ?? 0,
    });
    const command = latest().sent.find((frame) => frame.type === 'command') as Record<string, unknown>;
    expect(command.context).toEqual(original);
    expect(command.text).toBe('Write this');
    expect(client.snapshot().connection).toBe('ready');
    vi.advanceTimersByTime(10000);
    expect(latest().sent.at(-1)).toEqual({ type: 'ping' });
    const previous = latest();
    previous.close();
    expect(client.snapshot().connection).toBe('offline');
    vi.advanceTimersByTime(1200);
    latest().open();
    previous.receive({ type: 'presence', online: true });
    previous.onopen?.();
    previous.onclose?.({ code: 1008 });
    expect(client.snapshot().connection).toBe('connecting');
    latest().receive(snapshot);
    latest().receive({
      type: 'context.ack',
      tabId: client.context?.tabId ?? '',
      seq: client.context?.seq ?? 0,
    });
    expect(latest().sent).toContainEqual(command);
    latest().receive({ type: 'command.ack', id: String(command.id) });
    latest().receive({
      type: 'command.state',
      id: 'event',
      commandId: 'before-connect',
      status: 'cancelled',
      detail: '',
    });
    latest().close();
    vi.advanceTimersByTime(1200);
    latest().open();
    latest().receive(snapshot);
    expect(latest().sent.filter((frame) => frame.type === 'command' || frame.type === 'cancel')).toEqual([]);
    expect(subscriber).toHaveBeenCalled();
    expect(frameListener).toHaveBeenCalled();
    unsubscribe();
    off();
    subscriber.mockClear();
    frameListener.mockClear();
    latest().receive({ type: 'pong' });
    expect(subscriber).not.toHaveBeenCalled();
    expect(frameListener).not.toHaveBeenCalled();
  });
  it('retires controls against snapshot receipts and command completion', () => {
    client.command('queued');
    const id = client.state.commands[0].id;
    client.cancel(id);
    client.cancel('running');
    client.start();
    latest().open();
    latest().receive({
      ...snapshot,
      commands: [
        { id, status: 'complete', detail: '' },
        { id: 'running', status: 'working', detail: '' },
      ],
    });
    expect(latest().sent.filter((frame) => frame.type === 'command')).toEqual([]);
    expect(latest().sent).toContainEqual({ type: 'cancel', commandId: 'running' });
    latest().receive({
      type: 'command.state',
      id: 'event',
      commandId: 'running',
      status: 'working',
      detail: 'Wait',
    });
    latest().receive({
      type: 'command.state',
      id: 'event2',
      commandId: 'running',
      status: 'failed',
      detail: 'Failed',
    });
    latest().close();
    vi.advanceTimersByTime(1200);
    latest().open();
    latest().receive(snapshot);
    expect(latest().sent.filter((frame) => frame.type === 'cancel')).toEqual([]);
  });
  it('changes page epochs, rejects mismatched field routes, publishes only changed context', () => {
    connect();
    setField();
    expect(client.context).toBeNull();
    setPage();
    const original = client.context as PageContext;
    setPage();
    expect(client.context).toBe(original);
    client.field(
      { field: { productionId: 'other', field: 'transcript' }, draft: null, selection: null },
      () => true,
    );
    client.field(
      {
        field: { productionId: 'one', field: 'source.content', sourceId: 'deleted' },
        draft: null,
        selection: null,
      },
      () => true,
    );
    client.field(
      { field: { productionId: 'one', field: 'summary' }, draft: null, selection: null },
      () => true,
    );
    expect(client.context).toBe(original);
    setField();
    expect(client.context?.pageEpoch).toBe(original.pageEpoch);
    setPage({ version: 2 });
    expect(client.context?.field).toEqual(context.field);
    setPage({ step: 'brief', sourceId: 'source' });
    expect(client.context?.field).toBeNull();
    expect(client.context?.pageEpoch).toBe(original.pageEpoch + 1);
    client.field(
      {
        field: { productionId: 'one', field: 'source.title', sourceId: 'source' },
        draft: null,
        selection: null,
      },
      () => true,
    );
    expect(client.context?.field?.sourceId).toBe('source');
    setPage({ step: 'assets' });
    client.field(
      { field: { productionId: 'one', field: 'description' }, draft: null, selection: null },
      () => true,
    );
    expect(client.context?.field?.field).toBe('description');
  });
  it('applies exact proposals only once locally and queues explicit acknowledgements', () => {
    connect();
    setPage();
    const apply = setField();
    const target = { ...proposal, context: structuredClone(client.context as PageContext) };
    latest().receive({ type: 'proposal', proposal: target });
    expect(apply).toHaveBeenCalledOnce();
    expect(client.state.proposals).toEqual([]);
    expect(client.proposal(target, true)).toBe('applied');
    expect(apply).toHaveBeenCalledOnce();
    expect(latest().sent.at(-1)).toEqual({ type: 'proposal.ack', id: proposal.id, status: 'applied' });
    latest().receive({ type: 'proposal.ack', id: proposal.id, status: 'applied' });
    expect(client.state.proposals).toEqual([]);
    expect(client.proposal(target, true)).toBe('applied');
    expect(apply).toHaveBeenCalledOnce();
    latest().receive({ type: 'proposal', proposal: target });
    expect(client.state.proposals).toEqual([]);
    expect(client.proposal({ ...target, id: 'rejected' }, false)).toBe('rejected');
    setField(vi.fn(() => false));
    latest().receive({ type: 'proposal', proposal: { ...target, id: 'stale' } });
    expect(client.state.proposals.map((item) => item.id)).toEqual(['stale']);
    latest().receive({ type: 'proposal.ack', id: 'stale', status: 'stale' });
    expect(client.state.proposals.map((item) => item.id)).toEqual(['stale']);
    expect(client.proposal({ ...target, id: 'stale' }, false)).toBe('rejected');
    expect(client.proposal({ ...target, id: 'cannot-apply' }, true)).toBe('stale');
    expect(client.state.error).toContain('未覆盖');
    setPage({ step: 'brief' });
    expect(client.proposal({ ...target, id: 'old-page' }, true)).toBe('stale');
    latest().close();
    vi.advanceTimersByTime(1200);
    latest().open();
    latest().receive(snapshot);
    expect(latest().sent).toContainEqual({ type: 'proposal.ack', id: 'old-page', status: 'stale' });
  });
  it('bounds commands and outbox before mutating any draft', () => {
    expect(() => client.command(' ')).toThrow();
    expect(() => client.command('x'.repeat(12001))).toThrow();
    for (let index = 0; index < 100; index++) client.command(`message ${index}`);
    expect(() => client.command('overflow')).toThrow('待发送');
    expect(() => client.proposal(proposal, true)).toThrow('待发送');
  });
  it('rejects oversize and invalid current field drafts without silent truncation', () => {
    connect();
    setPage();
    client.field(
      { ...context, draft: { revision: 1, value: '界'.repeat(80000), baseValue: '界'.repeat(80000) } },
      () => true,
    );
    expect(() => client.command('edit')).toThrow('安全传输');
    expect(client.context?.draft?.value.length).toBe(80000);
    latest().close();
    vi.advanceTimersByTime(1200);
    latest().open();
    latest().receive(snapshot);
    expect(latest().sent.some((frame) => frame.type === 'context')).toBe(false);
    client.field({ ...context, draft: { revision: 1, value: 'x'.repeat(80001), baseValue: '' } }, () => true);
    expect(() => client.command('edit')).toThrow('安全传输');
  });
  it('times out a silent connection and does not reset backoff on open', () => {
    client.start();
    vi.advanceTimersByTime(30000);
    expect(latest().close).toHaveBeenCalled();
    vi.advanceTimersByTime(1200);
    expect(sockets).toHaveLength(2);
    latest().open();
    vi.advanceTimersByTime(30000);
    expect(latest().close).toHaveBeenCalled();
    vi.advanceTimersByTime(2400);
    expect(sockets.length).toBeGreaterThanOrEqual(3);
    client.stop();
    const count = sockets.length;
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(count);
    latest().receive(snapshot);
    expect(client.state.connection).not.toBe('ready');
  });
  it.each([1008, 4001, 4003, 4401, 4403])('halts retries after authentication failure %i', (code) => {
    connect();
    latest().close(code);
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
    expect(client.state.connection).toBe('blocked');
  });
  it.each(['{', JSON.stringify({ type: 'unknown' }), null, 'x'.repeat(256 * 1024 + 1)])(
    'rejects invalid server frame %j',
    (data) => {
      connect();
      latest().onmessage?.({ data });
      expect(latest().close).toHaveBeenCalled();
    },
  );
  it('isolates slow sockets and retains outbox for reconnect', () => {
    connect();
    latest().bufferedAmount = 1024 * 1024 + 1;
    client.command('retry');
    expect(latest().close).toHaveBeenCalledWith(1013);
    vi.advanceTimersByTime(1200);
    latest().open();
    latest().receive(snapshot);
    expect(latest().sent.some((frame) => frame.type === 'command')).toBe(true);
  });
});
