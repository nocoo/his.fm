import { z } from 'zod';
import type { Actor, AgentTokenRecord } from '../src/shared/production';
import { HttpError, json, requireSameOrigin } from './http';
import { readJson } from './production-body';

const tokenSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(365),
});
const publicFields =
  'id, name, prefix, created_at AS createdAt, expires_at AS expiresAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt';

async function hashToken(token: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function authenticateAgent(request: Request, env: Env): Promise<Actor> {
  const token = request.headers.get('Authorization')?.match(/^Bearer (hisfm_[a-f0-9]{64})$/)?.[1];
  if (!token) throw new HttpError(401, '需要有效的 Agent Token');
  const now = new Date().toISOString();
  const record = await env.DB.prepare(
    'UPDATE agent_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? RETURNING id, name',
  )
    .bind(now, await hashToken(token), now)
    .first<{ id: string; name: string }>();
  if (!record) throw new HttpError(401, 'Agent Token 已失效或被撤销');
  return { kind: 'agent', name: `${record.name} (${record.id})` };
}

export async function routeAgentTokens(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/admin/api/agent-tokens') {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT ${publicFields} FROM agent_tokens ORDER BY created_at DESC`,
      ).all<AgentTokenRecord>();
      return json({ tokens: results });
    }
    if (request.method === 'POST') {
      requireSameOrigin(request);
      const input = await readJson(request, tokenSchema);
      const token = `hisfm_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const now = new Date();
      const record: AgentTokenRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        prefix: token.slice(0, 14),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + input.expiresInDays * 86400000).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      };
      await env.DB.prepare(
        'INSERT INTO agent_tokens (id, name, prefix, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(
          record.id,
          record.name,
          record.prefix,
          await hashToken(token),
          record.createdAt,
          record.expiresAt,
        )
        .run();
      return json({ token, record }, 201);
    }
    throw new HttpError(405, '不支持这个请求方式');
  }
  if (/^\/admin\/api\/agent-tokens\/[^/]+$/.test(path)) {
    if (request.method !== 'DELETE') throw new HttpError(405, '不支持这个请求方式');
    requireSameOrigin(request);
    const record = await env.DB.prepare(
      'UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? RETURNING id',
    )
      .bind(new Date().toISOString(), path.slice('/admin/api/agent-tokens/'.length))
      .first();
    if (!record) throw new HttpError(404, 'Token 不存在');
    return new Response(null, { status: 204 });
  }
  throw new HttpError(404, '接口不存在');
}
