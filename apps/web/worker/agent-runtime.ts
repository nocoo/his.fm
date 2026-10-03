import { decodeJwt } from 'jose';
import { z } from 'zod';
import type { Actor } from '../src/shared/production';
import { readReceipt } from './agent-runtime-operation';
import { station } from './agent-runtime-store';
import { authenticateAgentIdentity } from './agent-tokens';
import { isLocal } from './auth';
import { HttpError, json, requireSameOrigin } from './http';
import { readJson } from './production-body';

export interface ConnectionIdentity {
  role: 'browser' | 'agent';
  connectionId: string;
  actor: Actor;
  tokenId: string;
  stationVersion: number;
  stationId: string;
  expiresAt: number;
  sessionHash: string | null;
  lastSeen: number;
  delivery?: { sent: number; acknowledged: number; pending: number[] };
}

const enrollmentSchema = z.strictObject({
  tokenId: z.string().min(1).max(160),
  stationId: z.string().regex(/^[a-zA-Z0-9._-]{1,160}$/),
  version: z.number().int().nonnegative().optional(),
});

export function hub(env: Env) {
  return env.AGENT_HUB.getByName(`his.fm:${env.ENVIRONMENT}`);
}

export function requireRuntimeOrigin(request: Request, env: Env, browser: boolean) {
  const url = new URL(request.url);
  if (env.ENVIRONMENT === 'local' ? !isLocal(request, env) : url.origin !== 'https://his.fm')
    throw new HttpError(403, '连接环境或域名不匹配');
  if (browser) {
    const site = request.headers.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin') throw new HttpError(403, '请从本站连接');
    if (request.method !== 'GET' || request.headers.has('Upgrade') || request.headers.has('Origin'))
      requireSameOrigin(request);
  } else if (request.headers.has('Origin')) throw new HttpError(403, '机器连接不接受浏览器 Origin');
  if (
    [...url.searchParams].some(([key, value]) => key !== 'protocol' || value !== '1') ||
    url.searchParams.getAll('protocol').length > 1
  )
    throw new HttpError(400, '连接参数无效');
}

async function browserLease(request: Request, env: Env) {
  if (!isLocal(request, env)) {
    const payload = decodeJwt(request.headers.get('Cf-Access-Jwt-Assertion') ?? '');
    return { expiresAt: Math.min(Date.now() + 900000, Number(payload.exp) * 1000), sessionHash: null };
  }
  const cookie =
    request.headers
      .get('Cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('hisfm_local_session='))
      ?.slice('hisfm_local_session='.length) ?? '';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cookie));
  const sessionHash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  const session = await env.DB.prepare(
    'SELECT expires_at AS expiresAt FROM local_sessions WHERE token_hash = ? AND expires_at > ?',
  )
    .bind(sessionHash, Date.now())
    .first<{ expiresAt: number }>();
  if (!session) throw new HttpError(401, '请重新登录');
  return { sessionHash, expiresAt: Math.min(Date.now() + 900000, session.expiresAt) };
}

export async function connectRuntime(request: Request, env: Env, actor?: Actor) {
  if (request.method !== 'GET') throw new HttpError(405, '连接只支持 GET');
  requireRuntimeOrigin(request, env, Boolean(actor));
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
    throw new HttpError(426, '需要 WebSocket 升级');
  const identity: ConnectionIdentity = {
    role: actor ? 'browser' : 'agent',
    connectionId: crypto.randomUUID(),
    actor: actor ?? { kind: 'agent', name: '' },
    tokenId: '',
    stationVersion: 0,
    stationId: '',
    expiresAt: 0,
    sessionHash: null,
    lastSeen: Date.now(),
  };
  if (actor) Object.assign(identity, await browserLease(request, env));
  else {
    const authentication = await authenticateAgentIdentity(request, env);
    const current = await station(env.DB);
    const stationId = request.headers.get('X-Hisfm-Station');
    if (!current || current.tokenId !== authentication.tokenId || current.stationId !== stationId)
      throw new HttpError(403, '请先由编辑绑定此 Token 与主控站点');
    Object.assign(identity, authentication, {
      stationId,
      stationVersion: current.version,
      expiresAt: Math.min(Date.now() + 900000, authentication.expiresAt),
    });
  }
  return hub(env).fetch(
    new Request('https://hub/connect', {
      headers: { Upgrade: 'websocket', 'X-Hisfm-Identity': JSON.stringify(identity) },
    }),
  );
}

export async function routeRuntimeAdmin(request: Request, env: Env, actor: Actor): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/admin/api/agent/live') return connectRuntime(request, env, actor);
  if (path === '/admin/api/agent/history') {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('before');
    const kind = url.searchParams.get('kind') ?? 'messages';
    if (request.method !== 'GET') throw new HttpError(405, '历史记录只支持 GET');
    if (
      (cursor !== null && !/^[1-9]\d*$/.test(cursor)) ||
      !['messages', 'proposals'].includes(kind) ||
      [...url.searchParams.keys()].some((key) => !['before', 'kind'].includes(key))
    )
      throw new HttpError(400, '历史分页参数无效');
    url.search = '';
    requireRuntimeOrigin(new Request(url, request), env, true);
    const query =
      kind === 'messages'
        ? "SELECT rowid AS cursor, data FROM agent_events WHERE type = 'message' AND rowid < ? ORDER BY rowid DESC LIMIT 20"
        : 'SELECT rowid AS cursor, data FROM agent_proposals WHERE rowid < ? ORDER BY rowid DESC LIMIT 20';
    const rows = await env.DB.prepare(query)
      .bind(cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER)
      .all<{ cursor: number; data: string }>();
    return json({
      items: rows.results.map((row) => ({ cursor: row.cursor, value: JSON.parse(row.data) })),
      nextCursor: rows.results.length === 20 ? rows.results.at(-1)?.cursor : null,
    });
  }
  requireRuntimeOrigin(request, env, true);
  if (path === '/admin/api/agent/snapshot' && request.method === 'GET')
    return hub(env).fetch('https://hub/snapshot');
  if (path !== '/admin/api/agent/station') throw new HttpError(404, '接口不存在');
  if (request.method === 'GET') {
    const current = await station(env.DB);
    return json({
      station: current
        ? { tokenId: current.tokenId, stationId: current.stationId, version: current.version }
        : null,
    });
  }
  if (request.method !== 'POST') throw new HttpError(405, '不支持这个请求方式');
  const input = await readJson(request, enrollmentSchema);
  const token = await env.DB.prepare(
    'SELECT id FROM agent_tokens WHERE id = ? AND revoked_at IS NULL AND expires_at > ?',
  )
    .bind(input.tokenId, new Date().toISOString())
    .first();
  if (!token) throw new HttpError(400, '请选择有效的主控 Token');
  const expectedVersion = input.version ?? 0;
  const result = await env.DB.prepare(
    'INSERT INTO agent_station (id, token_id, station_id, version) SELECT 1, ?, ?, 1 WHERE ? = 0 OR EXISTS (SELECT 1 FROM agent_station WHERE id = 1 AND version = ?) ON CONFLICT(id) DO UPDATE SET token_id = excluded.token_id, station_id = excluded.station_id, version = version + 1, generation = NULL, lease_until = 0 WHERE version = ?',
  )
    .bind(input.tokenId, input.stationId, expectedVersion, expectedVersion, expectedVersion)
    .run();
  if (!result.meta.changes) throw new HttpError(409, '站点绑定已更新，替换必须提供当前版本');
  await hub(env).fetch('https://hub/prune', { method: 'POST' });
  return json({
    station: { tokenId: input.tokenId, stationId: input.stationId, version: expectedVersion + 1 },
  });
}

export async function routeRuntimeReceipt(request: Request, env: Env) {
  if (request.method !== 'GET') throw new HttpError(405, '回执只支持 GET');
  requireRuntimeOrigin(request, env, false);
  const identity = await authenticateAgentIdentity(request, env);
  const current = await station(env.DB);
  if (
    !current ||
    current.tokenId !== identity.tokenId ||
    current.stationId !== request.headers.get('X-Hisfm-Station')
  )
    throw new HttpError(403, '主控绑定不匹配');
  const receipt = await readReceipt(
    env.DB,
    decodeURIComponent(new URL(request.url).pathname.slice('/api/agent/runtime/receipts/'.length)),
  );
  return json({ receipt }, receipt ? 200 : 202);
}

export async function notifyProductionChanged(env: Env, response: Response) {
  if (!response.ok || !env.AGENT_HUB) return;
  try {
    const result = (await response.clone().json()) as { production?: { id: string; version: number } };
    if (result.production)
      await hub(env).fetch('https://hub/production-changed', {
        method: 'POST',
        body: JSON.stringify({
          type: 'production.changed',
          productionId: result.production.id,
          version: result.production.version,
        }),
      });
  } catch {
    console.error(JSON.stringify({ event: 'agent_notification_failed' }));
  }
}
