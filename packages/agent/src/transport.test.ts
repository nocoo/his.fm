import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { RuntimeStore } from './store.ts';
import { FakeSocket, snapshot, testCommand, testConfig, testContext } from './testing/fixtures.ts';
import { RuntimeTransport } from './transport.ts';

afterEach(() => vi.useRealTimers());
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-transport-'));
  const store = new RuntimeStore(join(directory, 'db.sqlite'), 'test');
  const sockets: FakeSocket[] = [];
  const factory = vi.fn(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const logs: string[] = [];
  const transport = new RuntimeTransport(store, testConfig().websites.local, factory, (text) =>
    logs.push(text),
  );
  return {
    transport,
    store,
    sockets,
    factory,
    logs,
    open: () => {
      transport.start();
      const socket = sockets.at(-1);
      assert(socket);
      socket.emit('open');
      return socket;
    },
    ready: (socket: FakeSocket) => {
      socket.receive({ type: 'welcome', protocolVersion: 1, connectionId: 'connection' });
      socket.receive(snapshot);
    },
    close: async () => {
      transport.stop();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it('persists before acceptance, waits for snapshot and retires confirmed outbox events', async () => {
  const test = await setup();
  try {
    test.transport.send({ type: 'status', id: 'status', conversations: [] });
    const socket = test.open();
    test.transport.start();
    expect(socket.frames).toEqual([{ type: 'ping' }]);
    socket.receive({ type: 'welcome', protocolVersion: 1, connectionId: 'conn' });
    socket.receive({ type: 'command', command: testCommand() });
    expect(test.store.command('command-1')?.status).toBe('queued');
    expect(socket.frames).toHaveLength(1);
    socket.receive({ type: 'context', context: testContext });
    expect(test.store.get('latestContext')).toEqual(testContext);
    socket.receive(snapshot);
    expect(socket.frames).toContainEqual({ type: 'accepted', commandId: 'command-1' });
    expect(socket.frames).toContainEqual({ type: 'status', id: 'status', conversations: [] });
    socket.receive({ type: 'command.ack', id: 'command-1' });
    socket.receive({ type: 'event.ack', id: 'status' });
    expect(test.store.pending()).toEqual([]);
    const frames = socket.frames.length;
    test.transport.flush();
    expect(socket.frames.length).toBe(frames);
    socket.receive({ type: 'presence', online: true });
    socket.receive({ type: 'pong' });
    expect(test.transport.ready).toBe(true);
  } finally {
    await test.close();
  }
});

it('reconciles cancelled and terminal commands before ready and persists operation/proposal receipts', async () => {
  const test = await setup();
  try {
    const socket = test.open();
    socket.receive({ type: 'welcome', protocolVersion: 1, connectionId: 'conn' });
    for (const id of ['cancelled', 'cancelling', 'complete', 'failed']) test.store.receive(testCommand(id));
    const order: string[] = [];
    test.transport.on('cancel', (id) => order.push(`cancel:${id}`));
    test.transport.on('terminal', (id) => order.push(`terminal:${id}`));
    test.transport.on('ready', () => order.push('ready'));
    socket.receive({
      ...snapshot,
      commands: ['cancelled', 'cancelling', 'complete', 'failed', 'working'].map((status) => ({
        id: status,
        status,
        detail: '',
      })),
    });
    expect(order).toEqual([
      'cancel:cancelled',
      'cancel:cancelling',
      'terminal:complete',
      'terminal:failed',
      'ready',
    ]);
    expect(test.store.command('complete')?.status).toBe('complete');
    expect(test.store.get('cancelled:cancelling')).toBe(true);
    socket.receive({ type: 'cancel', commandId: 'new' });
    expect(order.at(-1)).toBe('cancel:new');
    socket.receive({ type: 'proposal.ack', id: 'proposal', status: 'stale' });
    expect(test.store.result('proposal')).toMatchObject({ status: 'stale' });
    const operation = {
      type: 'operation' as const,
      operation: { id: 'op', commandId: 'complete', kind: 'production.create' as const, brief: {} },
    };
    const pending = test.transport.operation(operation);
    socket.receive({ type: 'operation.result', id: 'other', ok: true, status: 200, result: {} });
    socket.receive({ type: 'operation.result', id: 'op', ok: true, status: 200, result: { created: true } });
    expect(await pending).toMatchObject({ ok: true });
    expect(await test.transport.operation(operation)).toMatchObject({ ok: true });
    expect(test.transport.listenerCount('receipt')).toBe(0);
    test.transport.ready = false;
    await expect(
      test.transport.operation({ ...operation, operation: { ...operation.operation, id: 'offline' } }),
    ).rejects.toThrow('未执行');
  } finally {
    await test.close();
  }
});

it('keeps heartbeat and uncertain effects independent of model work, reconnects with outbox intact', async () => {
  vi.useFakeTimers();
  const test = await setup();
  try {
    const socket = test.open();
    test.ready(socket);
    const operation = {
      type: 'operation' as const,
      operation: { id: 'op', commandId: 'command', kind: 'production.create' as const, brief: {} },
    };
    const pending = test.transport.operation(operation, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ pending: true, id: 'op' });
    await vi.advanceTimersByTimeAsync(19000);
    expect(socket.frames.filter((frame) => (frame as { type: string }).type === 'ping')).toHaveLength(3);
    expect(test.store.pending()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(22000);
    expect(test.factory).toHaveBeenCalledTimes(2);
    expect(test.transport.ready).toBe(false);
    const second = test.sockets[1];
    assert(second);
    second.emit('open');
    test.ready(second);
    expect(second.frames).toContainEqual(operation);
    socket.receive({ type: 'command', command: testCommand('stale') });
    socket.emit('open');
    socket.emit('close', 1008);
    expect(test.store.command('stale')).toBeNull();
    second.bufferedAmount = 600000;
    test.transport.send({ type: 'status', id: 'extra', conversations: [] });
    expect(second.readyState).toBe(3);
  } finally {
    await test.close();
  }
});

it('retries station contention and network errors but halts authorization and invalid schemas', async () => {
  vi.useFakeTimers();
  const test = await setup();
  try {
    const socket = test.open();
    socket.emit('unexpected-response', {}, { statusCode: 409, resume: vi.fn() });
    expect(test.transport.stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    const second = test.sockets[1];
    assert(second);
    second.emit('error', new Error('private upstream'));
    await vi.advanceTimersByTimeAsync(2500);
    const third = test.sockets[2];
    assert(third);
    third.emit('unexpected-response', {}, { statusCode: 403, resume: vi.fn() });
    expect(test.transport.stopped).toBe(true);
    expect(test.logs.join()).not.toContain('private upstream');
    third.receive({ type: 'command', command: testCommand() });
    expect(test.store.command('command-1')).toBeNull();
    test.transport.start();
    const fourth = test.sockets[3];
    assert(fourth);
    fourth.emit('open');
    fourth.receive({ type: 'unexpected' });
    expect(test.transport.stopped).toBe(true);
  } finally {
    await test.close();
  }
});

it('handles handshake timeout, binary/oversized frames, expired auth and permanent server errors', async () => {
  vi.useFakeTimers();
  const test = await setup();
  try {
    const socket = test.open();
    await vi.advanceTimersByTimeAsync(22000);
    expect(socket.readyState).toBe(3);
    const second = test.sockets[1];
    assert(second);
    second.emit('open');
    second.receive(snapshot);
    expect(test.transport.stopped).toBe(true);
    for (const payload of [{ value: 'binary' }, { value: 'x'.repeat(300000) }]) {
      test.transport.start();
      const active = test.sockets.at(-1);
      assert(active);
      active.emit('open');
      active.receive(payload, payload.value === 'binary');
      expect(test.transport.stopped).toBe(true);
    }
    test.transport.start();
    const auth = test.sockets.at(-1);
    assert(auth);
    auth.emit('close', 4001);
    expect(test.transport.stopped).toBe(true);
    test.transport.start();
    const errors = test.sockets.at(-1);
    assert(errors);
    errors.emit('open');
    test.ready(errors);
    errors.receive({ type: 'error', code: 'temporary', message: 'secret upstream' });
    expect(test.transport.stopped).toBe(false);
    errors.receive({ type: 'error', code: 'forbidden', message: 'secret upstream' });
    expect(test.transport.stopped).toBe(true);
    expect(test.logs.join()).not.toContain('secret upstream');
  } finally {
    await test.close();
  }
});

it('renews a stable connection before its authorization expires and backs off constructor failures', async () => {
  vi.useFakeTimers();
  const test = await setup();
  try {
    test.factory.mockImplementationOnce(() => {
      throw new Error('network');
    });
    test.transport.start();
    await vi.advanceTimersByTimeAsync(1500);
    const socket = test.sockets[0];
    assert(socket);
    socket.emit('open');
    test.ready(socket);
    for (let index = 0; index < 86; index++) {
      socket.receive({ type: 'pong' });
      await vi.advanceTimersByTimeAsync(10000);
    }
    expect(socket.readyState).toBe(3);
  } finally {
    await test.close();
  }
});

it('uses wss for production and survives an immediate operation receipt', async () => {
  const test = await setup();
  try {
    test.transport.site.baseUrl = 'https://example.test';
    const socket = test.open();
    test.ready(socket);
    const original = socket.send.bind(socket);
    socket.send = (value) => {
      original(value);
      const frame = JSON.parse(value);
      if (frame.type === 'operation')
        socket.receive({
          type: 'operation.result',
          id: frame.operation.id,
          ok: false,
          status: 409,
          result: {},
        });
    };
    expect(
      await test.transport.operation({
        type: 'operation',
        operation: { id: 'instant', commandId: 'command', kind: 'production.create', brief: {} },
      }),
    ).toMatchObject({ status: 409 });
    expect(test.factory.mock.calls.length).toBe(1);
  } finally {
    await test.close();
  }
});

import assert from 'node:assert/strict';
