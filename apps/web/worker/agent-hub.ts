import { DurableObject } from 'cloudflare:workers';
import {
  type AgentCommand,
  agentFrameSchema,
  aiStatusSchema,
  type BrowserFrame,
  browserFrameSchema,
  maxFrameBytes,
  type PageContext,
  protocolVersion,
  runtimeRequestSchema,
  type ServerFrame,
} from '@his-fm/contracts';
import type { ConnectionIdentity } from './agent-runtime';
import { executeOperation, persistOperationFailure } from './agent-runtime-operation';
import { enqueue, persistEvent, requireCommand, runtimeSnapshot, saveContext } from './agent-runtime-store';
import { triggerAudio } from './audio-routes';
import { getAudioSnapshot, setAudioState } from './audio-store';
import { HttpError, json } from './http';

export class AgentHub extends DurableObject<Env> {
  private pending: Promise<unknown> = Promise.resolve();
  private requests = new Map<string, { generation: string; resolve: (response: Response) => void }>();

  async runtimeRequest(request: Request): Promise<Response> {
    await this.prune();
    const socket = this.sockets('agent')[0];
    if (!socket) return json({ error: '主控离线，无法读取或修改本机配置' }, 503);
    const input = runtimeRequestSchema.safeParse(await request.json());
    if (!input.success) return json({ error: '配置请求无效' }, 400);
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.requests.delete(id);
        resolve(json({ error: '主控响应超时，请重新读取配置确认状态' }, 504));
      }, 15000);
      this.requests.set(id, {
        generation: this.identity(socket).connectionId,
        resolve: (response) => {
          clearTimeout(timeout);
          this.requests.delete(id);
          resolve(response);
        },
      });
      this.send(socket, { type: 'runtime.request', id, request: input.data });
    });
  }

  private serial<Result>(run: () => Promise<Result>): Promise<Result> {
    const result = this.pending.then(run);
    this.pending = result.catch(() => {});
    return result;
  }

  private identity(socket: WebSocket): ConnectionIdentity {
    return socket.deserializeAttachment() as ConnectionIdentity;
  }

  private sockets(role?: ConnectionIdentity['role']) {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket.readyState === 1 && (!role || this.identity(socket).role === role));
  }

  private send(socket: WebSocket, frame: ServerFrame) {
    if (socket.readyState !== 1) return;
    const identity = this.identity(socket);
    if (identity.role === 'browser' && frame.type === 'runtime.request') return;
    if (
      identity.role === 'browser' &&
      !['pong', 'welcome', 'context.ack', 'command.ack', 'error', 'presence'].includes(frame.type)
    ) {
      const delivery = identity.delivery ?? { sent: 0, acknowledged: 0, pending: [] };
      const encoded = JSON.stringify({ ...frame, deliveryId: delivery.sent + 1 });
      const bytes = new TextEncoder().encode(encoded).byteLength;
      if (
        bytes > maxFrameBytes ||
        delivery.pending.length >= 128 ||
        delivery.pending.reduce((total, size) => total + size, bytes) > 2 * 1024 * 1024
      ) {
        socket.close(1013, 'Delivery window exceeded; restore from snapshot');
        return;
      }
      delivery.sent++;
      delivery.pending.push(bytes);
      identity.delivery = delivery;
      socket.serializeAttachment(identity);
      frame = { ...frame, deliveryId: delivery.sent };
    }
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      socket.close(1011, 'Reconnect to restore durable state');
    }
  }

  private broadcast(frame: ServerFrame, role?: ConnectionIdentity['role']) {
    for (const socket of this.sockets(role)) this.send(socket, frame);
  }

  private async dispatchSpeech() {
    const pending = await this.env.DB.prepare(
      "SELECT agent_commands.data FROM speech_jobs JOIN agent_commands ON agent_commands.id = speech_jobs.command_id WHERE speech_jobs.status IN ('queued', 'running') AND agent_commands.status = 'queued' ORDER BY speech_jobs.created_at LIMIT 5",
    ).all<{ data: string }>();
    for (const row of pending.results)
      this.broadcast({ type: 'command', command: JSON.parse(row.data) as AgentCommand }, 'agent');
  }

  private async valid(identity: ConnectionIdentity) {
    const now = Date.now();
    if (identity.expiresAt <= now || identity.lastSeen + 35000 <= now) return false;
    if (identity.role === 'browser') {
      if (!identity.sessionHash) return true;
      return Boolean(
        await this.env.DB.prepare(
          'SELECT token_hash FROM local_sessions WHERE token_hash = ? AND expires_at > ?',
        )
          .bind(identity.sessionHash, now)
          .first(),
      );
    }
    return Boolean(
      await this.env.DB.prepare(
        'SELECT agent_station.id FROM agent_station JOIN agent_tokens ON agent_tokens.id = token_id WHERE agent_station.id = 1 AND token_id = ? AND version = ? AND generation = ? AND lease_until > ? AND revoked_at IS NULL AND expires_at > ?',
      )
        .bind(
          identity.tokenId,
          identity.stationVersion,
          identity.connectionId,
          now,
          new Date(now).toISOString(),
        )
        .first(),
    );
  }

  private async release(identity: ConnectionIdentity) {
    if (identity.role === 'agent')
      await this.env.DB.prepare(
        'UPDATE agent_station SET generation = NULL, lease_until = 0 WHERE generation = ?',
      )
        .bind(identity.connectionId)
        .run();
  }

  private async schedule() {
    const sockets = this.sockets();
    const queuedAudio = await this.env.DB.prepare(
      "SELECT id FROM audio_jobs WHERE status = 'queued' UNION ALL SELECT id FROM speech_jobs WHERE status IN ('queued', 'running') LIMIT 1",
    ).first();
    if (!sockets.length && !queuedAudio) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(
      Math.min(
        Date.now() + 10000,
        ...sockets.map((socket) => {
          const identity = this.identity(socket);
          return Math.min(identity.expiresAt, identity.lastSeen + 35000, Date.now() + 10000);
        }),
      ),
    );
  }

  private async prune() {
    let changed = false;
    for (const socket of this.sockets()) {
      const identity = this.identity(socket);
      if (await this.valid(identity)) continue;
      socket.close(
        identity.expiresAt <= Date.now() ? 4002 : identity.lastSeen + 35000 <= Date.now() ? 1013 : 4001,
        'Authorization or heartbeat expired',
      );
      await this.release(identity);
      changed ||= identity.role === 'agent';
    }
    if (changed) this.broadcast({ type: 'presence', online: this.sockets('agent').length > 0 }, 'browser');
    await this.schedule();
  }

  fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/runtime-request') return this.runtimeRequest(request);
    return this.serial(async () => {
      await this.prune();
      const path = new URL(request.url).pathname;
      if (path === '/snapshot')
        return json(await runtimeSnapshot(this.env.DB, this.sockets('agent').length > 0));
      if (path === '/prune') return json({ ok: true });
      if (path === '/speech-queued') {
        await this.dispatchSpeech();
        await this.schedule();
        return json({ ok: true });
      }
      if (path === '/production-changed') {
        const frame = (await request.json()) as Extract<ServerFrame, { type: 'production.changed' }>;
        this.broadcast(frame);
        return json({ ok: true });
      }
      if (path !== '/connect') return json({ error: 'Not found' }, 404);
      const identity = JSON.parse(
        request.headers.get('X-Hisfm-Identity') ?? 'null',
      ) as ConnectionIdentity | null;
      if (!identity || identity.expiresAt <= Date.now()) return json({ error: 'Unauthorized' }, 401);
      if (identity.role === 'agent') {
        if (this.sockets('agent').length) return json({ error: '主控已连接，不能抢占活跃站点' }, 409);
        const acquired = await this.env.DB.prepare(
          'UPDATE agent_station SET generation = ?, lease_until = ? WHERE id = 1 AND token_id = ? AND station_id = ? AND version = ? AND (generation IS NULL OR lease_until <= ?) AND EXISTS (SELECT 1 FROM agent_tokens WHERE id = token_id AND revoked_at IS NULL AND expires_at > ?)',
        )
          .bind(
            identity.connectionId,
            Math.min(Date.now() + 60000, identity.expiresAt),
            identity.tokenId,
            identity.stationId,
            identity.stationVersion,
            Date.now(),
            new Date().toISOString(),
          )
          .run();
        if (!acquired.meta.changes) return json({ error: '主控绑定或连接租约冲突' }, 409);
      } else if (this.sockets('browser').length >= 12) return json({ error: '工作室连接数量已达上限' }, 429);
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(identity);
      this.send(server, { type: 'welcome', protocolVersion, connectionId: identity.connectionId });
      if (identity.role === 'browser')
        this.send(server, await runtimeSnapshot(this.env.DB, this.sockets('agent').length > 0));
      if (identity.role === 'agent') {
        const snapshot = await runtimeSnapshot(this.env.DB, true);
        this.send(server, { ...snapshot, messages: [], proposals: [] });
        const contexts = await this.env.DB.prepare(
          'SELECT data FROM agent_contexts ORDER BY updated_at DESC LIMIT 12',
        ).all<{ data: string }>();
        for (const row of contexts.results.reverse())
          this.send(server, { type: 'context', context: JSON.parse(row.data) as PageContext });
        const commands = await this.env.DB.prepare(
          "SELECT data, status FROM agent_commands WHERE status NOT IN ('complete', 'failed', 'cancelled') ORDER BY created_at",
        ).all<{ data: string; status: string }>();
        for (const row of commands.results) {
          const command = JSON.parse(row.data) as AgentCommand;
          this.send(
            server,
            row.status === 'cancelling'
              ? { type: 'cancel', commandId: command.id }
              : { type: 'command', command },
          );
        }
        this.broadcast({ type: 'presence', online: true }, 'browser');
      }
      await this.schedule();
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string' && message.length <= maxFrameBytes) {
      let response: unknown;
      try {
        response = JSON.parse(message);
      } catch {
        response = null;
      }
      const parsed = agentFrameSchema.safeParse(response);
      if (parsed.success && parsed.data.type === 'runtime.response') {
        const frame = parsed.data;
        return (async () => {
          const identity = this.identity(socket);
          const pending = this.requests.get(frame.id);
          if (
            identity.role !== 'agent' ||
            !pending ||
            pending.generation !== identity.connectionId ||
            !(await this.valid(identity))
          )
            return;
          const status = aiStatusSchema.safeParse(frame.result);
          pending.resolve(
            frame.ok && status.success ? json(status.data) : json({ error: '本机配置不可用' }, 409),
          );
        })();
      }
    }
    return this.serial(async () => {
      try {
        const identity = this.identity(socket);
        if (socket.readyState !== 1 || !(await this.valid(identity))) {
          socket.close(
            identity.expiresAt <= Date.now() ? 4002 : identity.lastSeen + 35000 <= Date.now() ? 1013 : 4001,
            'Authorization or heartbeat expired',
          );
          await this.release(identity);
          return;
        }
        if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > maxFrameBytes)
          throw new HttpError(413, '帧内容过大或不是文本');
        let payload: unknown;
        try {
          payload = JSON.parse(message);
        } catch {
          throw new HttpError(400, '帧不是有效 JSON');
        }
        identity.lastSeen = Date.now();
        socket.serializeAttachment(identity);
        if (identity.role === 'agent') {
          const parsed = agentFrameSchema.safeParse(payload);
          if (!parsed.success) throw new HttpError(400, '机器帧不符合协议');
          const frame = parsed.data;
          await this.env.DB.prepare(
            'UPDATE agent_station SET lease_until = ? WHERE generation = ? AND version = ?',
          )
            .bind(
              Math.min(Date.now() + 60000, identity.expiresAt),
              identity.connectionId,
              identity.stationVersion,
            )
            .run();
          if (frame.type === 'runtime.response') return;
          if (frame.type === 'ping') this.send(socket, { type: 'pong' });
          else if (frame.type === 'accepted') {
            await requireCommand(this.env.DB, frame.commandId);
            await this.env.DB.prepare(
              "UPDATE agent_commands SET status = 'accepted' WHERE id = ? AND status = 'queued'",
            )
              .bind(frame.commandId)
              .run();
            this.send(socket, { type: 'command.ack', id: frame.commandId });
          } else if (frame.type === 'operation') {
            if (frame.operation.kind === 'audio.request') await this.ctx.storage.setAlarm(Date.now() + 10000);
            let result: Extract<ServerFrame, { type: 'operation.result' }>;
            try {
              result = await executeOperation(
                this.env,
                identity.actor,
                {
                  tokenId: identity.tokenId,
                  stationVersion: identity.stationVersion,
                  generation: identity.connectionId,
                  expiresAt: identity.expiresAt,
                },
                frame.operation,
              );
            } catch (error) {
              if (!(error instanceof HttpError)) throw error;
              result = await persistOperationFailure(this.env.DB, frame.operation, error);
            }
            this.send(socket, result);
            if (result.ok) {
              const value = result.result as { production: { id: string; version: number } };
              this.broadcast({
                type: 'production.changed',
                productionId: value.production.id,
                version: value.production.version,
              });
              if (frame.operation.kind === 'audio.request') await this.dispatchSpeech();
            }
          } else {
            const event = await persistEvent(this.env.DB, frame);
            this.send(socket, { type: 'event.ack', id: event.id });
            if (event.inserted) {
              if (frame.type === 'command.state') {
                const command = await requireCommand(this.env.DB, frame.commandId);
                this.broadcast({ ...frame, status: command.status }, 'browser');
              } else this.broadcast(frame, 'browser');
            }
            if (frame.type === 'proposal' && !event.inserted) {
              const proposal = await this.env.DB.prepare('SELECT status FROM agent_proposals WHERE id = ?')
                .bind(frame.proposal.id)
                .first<{ status: 'pending' | 'applied' | 'stale' | 'rejected' }>();
              if (proposal && proposal.status !== 'pending')
                this.send(socket, { type: 'proposal.ack', id: frame.proposal.id, status: proposal.status });
            }
          }
        } else {
          const parsed = browserFrameSchema.safeParse(payload);
          if (!parsed.success) throw new HttpError(400, '浏览器帧不符合协议');
          await this.browserMessage(socket, parsed.data);
        }
        await this.schedule();
      } catch (error) {
        this.send(socket, {
          type: 'error',
          code: error instanceof HttpError ? `http_${error.status}` : 'internal_error',
          message: error instanceof HttpError ? error.message : '服务暂时不可用，请使用原 ID 重试',
        });
      }
    });
  }

  private async browserMessage(socket: WebSocket, frame: BrowserFrame) {
    const db = this.env.DB;
    if (frame.type === 'ping') {
      this.send(socket, { type: 'pong' });
      return;
    }
    if (frame.type === 'delivery.ack') {
      const identity = this.identity(socket);
      const delivery = identity.delivery;
      if (!delivery || frame.deliveryId > delivery.sent) throw new HttpError(400, '确认超出已发送水位');
      const acknowledged = Math.max(delivery.acknowledged, frame.deliveryId);
      delivery.pending = delivery.pending.slice(acknowledged - delivery.acknowledged);
      delivery.acknowledged = acknowledged;
      socket.serializeAttachment(identity);
      return;
    }
    if (frame.type === 'context') {
      if (await saveContext(db, frame.context)) this.broadcast(frame, 'agent');
      this.send(socket, { type: 'context.ack', seq: frame.context.seq, tabId: frame.context.tabId });
    } else if (frame.type === 'command') {
      const { type: _type, ...input } = frame;
      const saved = await enqueue(db, input);
      this.send(socket, { type: 'command.ack', id: frame.id });
      if (saved.inserted) {
        this.broadcast({ type: 'command', command: saved.command }, 'agent');
        this.broadcast(
          {
            type: 'message',
            message: {
              id: frame.id,
              role: 'user',
              text: frame.text,
              commandId: frame.id,
              createdAt: saved.command.createdAt,
            },
          },
          'browser',
        );
      }
    } else if (frame.type === 'cancel') {
      await requireCommand(db, frame.commandId);
      const updated = await db
        .prepare(
          "UPDATE agent_commands SET status = 'cancelling', detail = '' WHERE id = ? AND status NOT IN ('complete', 'failed', 'cancelled')",
        )
        .bind(frame.commandId)
        .run();
      if (updated.meta.changes) {
        this.broadcast(frame, 'agent');
        this.broadcast(
          {
            type: 'command.state',
            id: frame.commandId,
            commandId: frame.commandId,
            status: 'cancelling',
            detail: '',
          },
          'browser',
        );
      }
    } else {
      const updated = await db
        .prepare(
          "UPDATE agent_proposals SET status = ? WHERE id = ? AND (status = 'pending' OR status = ?) RETURNING id",
        )
        .bind(frame.status, frame.id, frame.status)
        .first();
      if (!updated) throw new HttpError(409, '建议不存在或已经确认');
      this.broadcast(frame);
    }
  }

  webSocketClose(socket: WebSocket): Promise<void> {
    return this.serial(async () => {
      socket.close(1000, 'Connection closed');
      const identity = this.identity(socket);
      await this.release(identity);
      if (identity.role === 'agent')
        this.broadcast({ type: 'presence', online: this.sockets('agent').length > 0 }, 'browser');
      await this.schedule();
    });
  }

  webSocketError(socket: WebSocket): Promise<void> {
    return this.webSocketClose(socket);
  }
  alarm(): Promise<void> {
    return this.serial(async () => {
      const ended = await this.env.DB.prepare(
        "SELECT speech_jobs.id, speech_jobs.kind FROM speech_jobs JOIN agent_commands ON agent_commands.id=speech_jobs.command_id WHERE speech_jobs.status IN ('queued','running') AND agent_commands.status IN ('complete','failed','cancelled')",
      ).all<{ id: string; kind: string }>();
      for (const job of ended.results) {
        if (job.kind === 'production')
          await setAudioState(
            this.env,
            await getAudioSnapshot(this.env.DB, job.id),
            'failed',
            '主控任务已结束，语音未完成，请重试',
          );
        await this.env.DB.prepare("UPDATE speech_jobs SET status='failed' WHERE id=? AND status!='complete'")
          .bind(job.id)
          .run();
      }
      const queued = await this.env.DB.prepare(
        "SELECT id FROM audio_jobs WHERE status = 'queued' ORDER BY updated_at, id LIMIT 5",
      ).all<{ id: string }>();
      for (const job of queued.results) {
        const pending = await this.env.DB.prepare(
          "UPDATE audio_jobs SET updated_at = ? WHERE id = ? AND status = 'queued' RETURNING id",
        )
          .bind(new Date().toISOString(), job.id)
          .first();
        if (!pending) continue;
        try {
          await triggerAudio(this.env, job.id);
        } catch {
          console.error(JSON.stringify({ event: 'agent_audio_dispatch_pending', jobId: job.id }));
        }
      }
      await this.dispatchSpeech();
      await this.prune();
    });
  }
}
