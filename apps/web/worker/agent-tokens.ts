import { grantsSchema } from '@his-fm/contracts';
import { z } from 'zod';
import type { Actor, AgentTokenRecord } from '../src/shared/production';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readJson } from './production-body';

export const tokenSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(365),
  scopes: grantsSchema.min(1),
});
const publicFields =
  'id, name, prefix, scopes, created_at AS createdAt, expires_at AS expiresAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt';

async function hashToken(token: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function authenticateAgent(request: Request, env: Env): Promise<Actor> {
  const token = request.headers.get('Authorization')?.match(/^Bearer (hisfm_[a-f0-9]{64})$/i)?.[1];
  if (!token) throw new HttpError(401, '需要有效的 Agent Token');
  const now = new Date().toISOString();
  const record = await env.DB.prepare(
    'UPDATE agent_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND json_array_length(scopes) > 0 RETURNING id, name, scopes, expires_at AS expiresAt',
  )
    .bind(now, await hashToken(token), now)
    .first<{ id: string; name: string; scopes: string; expiresAt: string }>();
  if (!record) throw new HttpError(401, 'Agent Token 已失效或被撤销');
  const grants = grantsSchema.safeParse(JSON.parse(record.scopes));
  if (!grants.success || !grants.data.length) throw new HttpError(401, 'Agent Token grants are invalid');
  return {
    kind: 'agent',
    name: `${record.name} (${record.id})`,
    tokenId: record.id,
    scopes: grants.data,
    expiresAt: Date.parse(record.expiresAt),
  };
}

export async function routeAgentTokens(
  request: Request,
  env: Env,
  path: string,
  actor: Actor,
): Promise<Response> {
  path = path.replace(/^\/admin\/api/, '');
  if (path === '/agent-tokens') {
    if (request.method === 'GET') {
      requireScope(actor, 'tokens:read');
      const { results } = await env.DB.prepare(
        `SELECT ${publicFields} FROM agent_tokens WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      ).all<Omit<AgentTokenRecord, 'scopes'> & { scopes: string }>();
      return json({
        tokens: results.map((record) => {
          const stored: unknown = JSON.parse(record.scopes);
          const grants = grantsSchema.safeParse(stored);
          return {
            ...record,
            scopes: grants.success ? grants.data : [],
            ...(!grants.success
              ? {
                  invalidScopes: (Array.isArray(stored) ? stored : [stored]).map((value) =>
                    typeof value === 'string' ? value : JSON.stringify(value),
                  ),
                }
              : {}),
          };
        }),
      });
    }
    if (request.method === 'POST') {
      requireScope(actor, 'tokens:issue');
      const input = await readJson(request, tokenSchema);
      const now = new Date();
      const expiresAt = now.getTime() + input.expiresInDays * 86400000;
      if (
        actor.kind === 'agent' &&
        (!actor.tokenId ||
          !actor.expiresAt ||
          expiresAt > actor.expiresAt ||
          input.scopes.some((scope) => !actor.scopes?.includes(scope)))
      )
        throw new HttpError(403, 'Issued token must stay within issuer grants and expiry');
      const token = `hisfm_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const record: AgentTokenRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        prefix: token.slice(0, 14),
        createdAt: now.toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
        scopes: input.scopes,
      };
      const issuerId = actor.kind === 'agent' ? actor.tokenId : null;
      const inserted = await env.DB.prepare(
        `INSERT INTO agent_tokens (id, name, prefix, token_hash, created_at, expires_at, scopes, parent_id)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (
          SELECT 1 FROM agent_tokens issuer WHERE issuer.id = ? AND issuer.revoked_at IS NULL
          AND issuer.expires_at >= ?
          AND EXISTS (SELECT 1 FROM json_each(issuer.scopes) WHERE value = 'tokens:issue')
          AND NOT EXISTS (SELECT 1 FROM json_each(?) requested WHERE NOT EXISTS (
            SELECT 1 FROM json_each(issuer.scopes) granted WHERE granted.value = requested.value
          ))
        ) RETURNING id`,
      )
        .bind(
          record.id,
          record.name,
          record.prefix,
          await hashToken(token),
          record.createdAt,
          record.expiresAt,
          JSON.stringify(record.scopes),
          issuerId,
          issuerId,
          issuerId,
          record.expiresAt,
          JSON.stringify(record.scopes),
        )
        .first();
      if (!inserted) throw new HttpError(403, 'Issuer authority changed before token issuance');
      return json({ token, record }, 201);
    }
    throw new HttpError(405, '不支持这个请求方式');
  }
  const target = path.match(/^\/agent-tokens\/([^/]+)(\/revoke)?$/);
  if (target) {
    const revoking = Boolean(target[2]);
    if (request.method !== (revoking ? 'POST' : 'DELETE')) throw new HttpError(405, '不支持这个请求方式');
    requireScope(actor, revoking ? 'tokens:revoke' : 'tokens:delete');
    const id = decodeURIComponent(target[1]);
    const record = await env.DB.prepare('SELECT scopes FROM agent_tokens WHERE id = ?')
      .bind(id)
      .first<{ scopes: string }>();
    if (!record) throw new HttpError(404, 'Token 不存在');
    if (actor.kind === 'agent') {
      const targetGrants = grantsSchema.safeParse(JSON.parse(record.scopes));
      if (!targetGrants.success || targetGrants.data.some((scope) => !actor.scopes?.includes(scope)))
        throw new HttpError(403, 'Cannot manage a token outside your grants');
    }
    if (!revoking) {
      const removed = await env.DB.prepare(
        'UPDATE agent_tokens SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND revoked_at IS NOT NULL RETURNING id',
      )
        .bind(new Date().toISOString(), id)
        .first();
      if (!removed) throw new HttpError(409, '请先撤销令牌，再删除记录');
      return new Response(null, { status: 204 });
    }
    await env.DB.prepare(
      'WITH RECURSIVE descendants(id) AS (SELECT id FROM agent_tokens WHERE id = ? UNION ALL SELECT child.id FROM agent_tokens child JOIN descendants parent ON child.parent_id = parent.id) UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id IN (SELECT id FROM descendants)',
    )
      .bind(id, new Date().toISOString())
      .run();
    return new Response(null, { status: 204 });
  }
  throw new HttpError(404, '接口不存在');
}
