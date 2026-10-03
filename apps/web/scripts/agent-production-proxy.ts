import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';
import { accessToken } from './production-proxy';

const path = '/admin/remote-api/agent/live';
const hosts = new Set(['localhost', '127.0.0.1', '[::1]', 'hisfm.dev.hexly.ai']);

export function validAgentUpgrade(request: IncomingMessage) {
  try {
    const local = new URL(`http://${request.headers.host}`);
    const url = new URL(request.url ?? '', local);
    const origin = `${local.hostname === 'hisfm.dev.hexly.ai' ? 'https' : 'http'}://${local.host}`;
    return (
      request.method === 'GET' &&
      hosts.has(local.hostname) &&
      local.host === request.headers.host &&
      request.headers.origin === origin &&
      request.headers.upgrade?.toLowerCase() === 'websocket' &&
      url.pathname === path &&
      !url.hash &&
      !local.username &&
      !local.password &&
      [...url.searchParams.keys()].every((key) => key === 'protocol') &&
      url.searchParams.getAll('protocol').length <= 1 &&
      (!url.searchParams.has('protocol') || url.searchParams.get('protocol') === '1')
    );
  } catch {
    return false;
  }
}

export function agentProductionProxy(): Plugin {
  return {
    name: 'hisfm-agent-production-websocket',
    apply: 'serve',
    configureServer(server) {
      const local = new WebSocketServer({ noServer: true, maxPayload: 262144 });
      const pending = new Set<WebSocket>();
      const reject = (socket: Duplex, status: number) =>
        socket.end(
          `HTTP/1.1 ${status} Connection rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      const upgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!validAgentUpgrade(request)) {
          reject(socket, 403);
          return;
        }
        let token: string;
        try {
          token = await accessToken();
        } catch {
          reject(socket, 401);
          return;
        }
        if (socket.destroyed) return;
        const remote = new WebSocket('wss://his.fm/admin/api/agent/live?protocol=1', {
          headers: { Cookie: `CF_Authorization=${token}`, Origin: 'https://his.fm' },
          followRedirects: false,
          handshakeTimeout: 10000,
          maxPayload: 262144,
        });
        pending.add(remote);
        const stop = () => {
          pending.delete(remote);
          remote.terminate();
        };
        socket.once('close', stop);
        remote.once('unexpected-response', (_request, response) => {
          response.destroy();
          reject(socket, 502);
          stop();
        });
        remote.once('error', () => {
          reject(socket, 502);
          stop();
        });
        remote.once('open', () => {
          if (socket.destroyed) {
            stop();
            return;
          }
          local.handleUpgrade(request, socket, head, (client) => {
            const close = () => {
              client.terminate();
              stop();
            };
            const forward = (target: WebSocket, data: WebSocket.RawData, binary: boolean) => {
              if (target.readyState !== WebSocket.OPEN || target.bufferedAmount > 524288) {
                close();
                return;
              }
              target.send(data, { binary });
            };
            client.on('message', (data, binary) => forward(remote, data, binary));
            remote.on('message', (data, binary) => forward(client, data, binary));
            client.once('close', stop);
            client.once('error', close);
            remote.once('close', close);
          });
        });
      };
      const listener = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        void upgrade(request, socket, head);
      };
      server.httpServer?.once('close', () => {
        for (const socket of pending) socket.terminate();
        local.close();
      });
      return () => {
        const http = server.httpServer;
        if (!http) return;
        const upstream = http.listeners('upgrade');
        http.removeAllListeners('upgrade');
        // Cloudflare also handles upgrades; never dispatch this socket to both handlers.
        http.on('upgrade', (request, socket, head) => {
          if (request.url?.split('?')[0] === path) listener(request, socket, head);
          else for (const handler of upstream) Reflect.apply(handler, http, [request, socket, head]);
        });
      };
    },
  };
}
