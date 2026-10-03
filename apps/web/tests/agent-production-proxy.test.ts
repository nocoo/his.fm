import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { ViteDevServer } from 'vite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeSocket = EventEmitter & {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  url?: string;
  options?: unknown;
};
const mock = vi.hoisted(() => ({ sockets: [] as FakeSocket[], clients: [] as FakeSocket[], token: vi.fn() }));
vi.mock('ws', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Socket extends Emitter {
    readyState = 1;
    bufferedAmount = 0;
    send = vi.fn();
    terminate = vi.fn(() => {
      this.readyState = 3;
    });
    static OPEN = 1;
    constructor(
      public url?: string,
      public options?: unknown,
    ) {
      super();
      if (url) mock.sockets.push(this);
    }
  }
  return {
    default: Socket,
    WebSocketServer: class {
      close = vi.fn();
      handleUpgrade(_request: unknown, _socket: unknown, _head: unknown, callback: (socket: Socket) => void) {
        const client = new Socket();
        mock.clients.push(client);
        callback(client);
      }
    },
  };
});
vi.mock('../scripts/production-proxy', () => ({ accessToken: mock.token }));

import { agentProductionProxy, validAgentUpgrade } from '../scripts/agent-production-proxy';

const request = (changes: Record<string, unknown> = {}) =>
  ({
    method: 'GET',
    url: '/admin/remote-api/agent/live?protocol=1',
    headers: { host: '127.0.0.1:7056', origin: 'http://127.0.0.1:7056', upgrade: 'websocket' },
    ...changes,
  }) as IncomingMessage;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const server = new EventEmitter();
  const plugin = agentProductionProxy();
  const post = Reflect.apply(plugin.configureServer as (...args: unknown[]) => () => void, undefined, [
    { httpServer: server } as ViteDevServer,
  ]);
  const otherUpgrade = vi.fn();
  server.on('upgrade', otherUpgrade);
  post();
  const socket = Object.assign(new EventEmitter(), { end: vi.fn(), destroyed: false });
  return { server, socket, otherUpgrade };
}
beforeEach(() => {
  mock.sockets.length = 0;
  mock.token.mockReset().mockResolvedValue('fake.jwt.token');
  mock.clients.length = 0;
});
describe('fixed production WebSocket proxy', () => {
  it('accepts only exact local origin and bounded protocol query', () => {
    expect(validAgentUpgrade(request())).toBe(true);
    expect(validAgentUpgrade(request({ url: '/admin/remote-api/agent/live' }))).toBe(true);
    expect(
      validAgentUpgrade(
        request({
          headers: { host: 'hisfm.dev.hexly.ai', origin: 'https://hisfm.dev.hexly.ai', upgrade: 'websocket' },
        }),
      ),
    ).toBe(true);
    for (const url of [
      '/admin/remote-api/agent/live?token=secret',
      '/admin/remote-api/agent/live?protocol=2',
      '/admin/remote-api/agent/live?protocol=1&protocol=1',
      '/wrong',
      '/admin/remote-api/agent/live#secret',
    ])
      expect(validAgentUpgrade(request({ url }))).toBe(false);
    expect(validAgentUpgrade(request({ method: 'POST' }))).toBe(false);
    expect(validAgentUpgrade(request({ url: undefined }))).toBe(false);
    expect(validAgentUpgrade(request({ headers: { host: 'bad host' } }))).toBe(false);
    expect(
      validAgentUpgrade(request({ headers: { host: 'evil.example', origin: 'https://evil.example' } })),
    ).toBe(false);
    expect(
      validAgentUpgrade(
        request({
          headers: { host: '127.0.0.1:7056', origin: 'https://evil.example', upgrade: 'websocket' },
        }),
      ),
    ).toBe(false);
  });
  it('ignores other upgrades and rejects origin or auth failures', async () => {
    const { server, socket, otherUpgrade } = fixture();
    server.emit('upgrade', request({ url: '/vite-hmr' }), socket, Buffer.alloc(0));
    expect(mock.token).not.toHaveBeenCalled();
    expect(otherUpgrade).toHaveBeenCalledTimes(1);
    server.emit('upgrade', request({ headers: {} }), socket, Buffer.alloc(0));
    expect(otherUpgrade).toHaveBeenCalledTimes(1);
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('403'));
    mock.token.mockRejectedValueOnce(new Error('secret'));
    server.emit('upgrade', request(), socket, Buffer.alloc(0));
    await settle();
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('401'));
    socket.destroyed = true;
    server.emit('upgrade', request(), socket, Buffer.alloc(0));
    await settle();
    expect(mock.sockets).toHaveLength(0);
    server.emit('close');
    Reflect.apply(agentProductionProxy().configureServer as (...args: unknown[]) => () => void, undefined, [
      {},
    ])();
  });
  it('does not follow redirects or forward browser credentials', async () => {
    const { server, socket } = fixture();
    server.emit('upgrade', request(), socket, Buffer.alloc(0));
    await settle();
    const remote = mock.sockets[0];
    expect(remote.url).toBe('wss://his.fm/admin/api/agent/live?protocol=1');
    expect(remote.options).toMatchObject({
      followRedirects: false,
      headers: { Cookie: 'CF_Authorization=fake.jwt.token', Origin: 'https://his.fm' },
    });
    const response = { destroy: vi.fn() };
    remote.emit('unexpected-response', {}, response);
    expect(response.destroy).toHaveBeenCalled();
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('502'));
    expect(remote.terminate).toHaveBeenCalled();
    server.emit('close');
  });
  it('cleans failed and closed connections without leaking exceptions', async () => {
    const { server, socket } = fixture();
    server.emit('upgrade', request(), socket, Buffer.alloc(0));
    await settle();
    const remote = mock.sockets[0];
    remote.emit('error', new Error('secret'));
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('502'));
    socket.emit('close');
    server.emit('close');
    const dead = fixture();
    dead.server.emit('upgrade', request(), dead.socket, Buffer.alloc(0));
    await settle();
    dead.socket.destroyed = true;
    mock.sockets[1].emit('open');
    expect(mock.sockets[1].terminate).toHaveBeenCalled();
    dead.server.emit('close');
  });
  it.each(['pressure', 'not-open', 'error', 'close'])('forwards frames and stops on %s', async (reason) => {
    const { server, socket } = fixture();
    server.emit('upgrade', request(), socket, Buffer.alloc(0));
    await settle();
    const remote = mock.sockets[0];
    remote.emit('open');
    const client = mock.clients[0];
    client.emit('message', Buffer.from('client'), false);
    expect(remote.send).toHaveBeenCalledWith(Buffer.from('client'), { binary: false });
    remote.emit('message', Buffer.from('remote'), false);
    expect(client.send).toHaveBeenCalledWith(Buffer.from('remote'), { binary: false });
    if (reason === 'pressure') {
      remote.bufferedAmount = 600000;
      client.emit('message', Buffer.from('x'), false);
    }
    if (reason === 'not-open') {
      remote.readyState = 3;
      client.emit('message', Buffer.from('x'), false);
    }
    if (reason === 'error') client.emit('error', new Error('x'));
    if (reason === 'close') remote.emit('close');
    expect(remote.terminate).toHaveBeenCalled();
    server.emit('close');
  });
});
