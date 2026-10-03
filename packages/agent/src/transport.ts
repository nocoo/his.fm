import { EventEmitter } from 'node:events';
import { type AgentFrame, maxFrameBytes, type ServerFrame, serverFrameSchema } from '@his-fm/contracts';
import WebSocket from 'ws';
import type { Config } from './config.ts';
import { frameId, type RuntimeStore } from './store.ts';

export type SocketFactory = (url: string, options: WebSocket.ClientOptions) => WebSocket;
export class RuntimeTransport extends EventEmitter {
  ready = false;
  stopped = true;
  private socket: WebSocket | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private lastIncoming = 0;
  private openedAt = 0;
  private attempts = 0;
  private welcomed = false;
  private sent = new Set<string>();
  readonly store: RuntimeStore;
  readonly site: Config['websites']['local'];
  private readonly factory: SocketFactory;
  private readonly log: (message: string) => void;
  constructor(
    store: RuntimeStore,
    site: Config['websites']['local'],
    factory: SocketFactory = (url, options) => new WebSocket(url, options),
    log: (message: string) => void = console.log,
  ) {
    super();
    this.store = store;
    this.site = site;
    this.factory = factory;
    this.log = log;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }
  private connect() {
    const url = new URL('/api/agent/runtime/connect', this.site.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try {
      socket = this.factory(url.href, {
        headers: { Authorization: `Bearer ${this.site.token}`, 'X-Hisfm-Station': this.site.stationId },
        followRedirects: false,
        handshakeTimeout: 10000,
        maxPayload: maxFrameBytes,
      });
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    this.welcomed = false;
    this.sent.clear();
    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.openedAt = this.lastIncoming = Date.now();
      socket.send(JSON.stringify({ type: 'ping' }));
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastIncoming > 30000 || (!this.ready && Date.now() - this.openedAt > 10000)) {
          socket.terminate();
          return;
        }
        if (this.ready && Date.now() - this.openedAt > 30000) this.attempts = 0;
        if (Date.now() - this.openedAt > 14 * 60000) {
          socket.close(1000);
          return;
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        this.sent.clear();
        this.flush();
      }, 10000);
    });
    socket.on('message', (data, binary) => {
      if (this.socket !== socket || this.stopped) return;
      try {
        if (binary || Buffer.byteLength(data.toString()) > maxFrameBytes) throw new Error('Invalid frame');
        const frame = serverFrameSchema.parse(JSON.parse(data.toString()));
        this.lastIncoming = Date.now();
        this.receive(frame);
      } catch {
        this.halt('实时协议不匹配，任务已保留，请更新客户端。');
      }
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      if ([401, 403].includes(response.statusCode ?? 0))
        this.halt('网站授权或工作站登记无效，请检查本机配置。');
      else socket.terminate();
    });
    socket.on('error', () => {
      socket.terminate();
    });
    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      this.ready = false;
      clearInterval(this.heartbeat);
      this.emit('offline');
      if ([1008, 4001, 4003, 4009, 4401, 4403].includes(code))
        this.halt('连接授权已失效，任务和草稿已保留。');
      else this.retry();
    });
  }
  private retry() {
    if (this.stopped || this.reconnect) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)) * (0.8 + Math.random() * 0.4);
    this.reconnect = setTimeout(() => {
      this.reconnect = undefined;
      this.connect();
    }, delay);
  }
  private halt(message: string) {
    this.stop();
    this.log(message);
    this.emit('halt');
  }
  receive(frame: ServerFrame) {
    switch (frame.type) {
      case 'welcome':
        this.welcomed = true;
        break;
      case 'snapshot':
        if (!this.welcomed) throw new Error('Snapshot before welcome');
        for (const command of frame.commands) {
          if (['cancelled', 'cancelling'].includes(command.status)) {
            this.store.set(`cancelled:${command.id}`, true);
            this.emit('cancel', command.id);
          } else if (['complete', 'failed'].includes(command.status)) {
            this.store.database
              .prepare('UPDATE commands SET status=? WHERE id=?')
              .run(command.status, command.id);
            this.emit('terminal', command.id);
          }
        }
        this.ready = true;
        this.flush();
        this.emit('ready');
        break;
      case 'event.ack':
        this.store.acknowledge(frame.id);
        this.flush();
        break;
      case 'command.ack':
        this.store.acknowledge(`accepted:${frame.id}`);
        this.flush();
        break;
      case 'command':
        this.store.receive(frame.command);
        this.flush();
        this.emit('command', frame.command);
        break;
      case 'cancel':
        this.emit('cancel', frame.commandId);
        break;
      case 'context':
        this.store.context(frame.context);
        break;
      case 'operation.result':
      case 'proposal.ack':
        this.store.receipt(frame);
        this.emit('receipt', frame);
        break;
      case 'error':
        if (['unauthorized', 'forbidden', 'station_mismatch', 'protocol_mismatch'].includes(frame.code))
          this.halt('网站拒绝当前连接，请检查授权。');
        else this.log('网站暂时无法处理请求，未确认任务已保留。');
        break;
    }
  }
  send(frame: Exclude<AgentFrame, { type: 'ping' }>) {
    this.store.enqueue(frame);
    this.flush();
  }
  flush() {
    const socket = this.socket;
    if (!this.ready || !socket || socket.readyState !== WebSocket.OPEN) return;
    for (const frame of this.store.pending()) {
      const id = frameId(frame);
      if (this.sent.has(id)) continue;
      if (socket.bufferedAmount > maxFrameBytes * 2) {
        socket.terminate();
        return;
      }
      socket.send(JSON.stringify(frame));
      this.sent.add(id);
    }
  }
  async operation(frame: Extract<AgentFrame, { type: 'operation' }>, timeoutMs = 30000) {
    const previous = this.store.result(frame.operation.id);
    if (previous) return previous;
    if (!this.ready) throw new Error('连接尚未恢复，未执行网站写入。');
    this.send(frame);
    return new Promise<Extract<ServerFrame, { type: 'operation.result' }> | { pending: true; id: string }>(
      (resolve) => {
        const onReceipt = (result: Extract<ServerFrame, { type: 'operation.result' | 'proposal.ack' }>) => {
          if (result.id !== frame.operation.id || result.type !== 'operation.result') return;
          clearTimeout(timer);
          this.off('receipt', onReceipt);
          resolve(result);
        };
        const timer = setTimeout(() => {
          this.off('receipt', onReceipt);
          resolve({ pending: true, id: frame.operation.id });
        }, timeoutMs);
        this.on('receipt', onReceipt);
        const result = this.store.result(frame.operation.id);
        if (result) onReceipt(result);
      },
    );
  }
  stop() {
    this.stopped = true;
    this.ready = false;
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    this.socket?.terminate();
  }
}
