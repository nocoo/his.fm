import {
  grantsSchema,
  hasScope,
  type Principal,
  principalSchema,
  type Scope,
  scopes,
} from '@his-fm/contracts';
import { HttpError } from './http';

export function requireScope(actor: Principal, scope: Scope): void {
  if (!hasScope(actor, scope)) throw new HttpError(403, `Missing scope: ${scope}`);
}

export async function currentPrincipal(db: D1Database, ceiling: Principal): Promise<Principal> {
  if (ceiling.kind === 'human') return ceiling;
  if (!ceiling.tokenId) throw new HttpError(403, 'Task has no authorized originator');
  if (!ceiling.expiresAt || ceiling.expiresAt <= Date.now())
    throw new HttpError(403, 'Task authority has expired');
  const row = await db
    .prepare(
      'SELECT scopes, expires_at AS expiresAt FROM agent_tokens WHERE id = ? AND revoked_at IS NULL AND expires_at > ?',
    )
    .bind(ceiling.tokenId, new Date().toISOString())
    .first<{ scopes: string; expiresAt: string }>();
  if (!row) throw new HttpError(403, 'Task originator token is no longer valid');
  const grants = grantsSchema.parse(JSON.parse(row.scopes));
  return {
    ...ceiling,
    scopes: grants.filter((scope) => ceiling.scopes?.includes(scope)),
    expiresAt: Math.min(ceiling.expiresAt, Date.parse(row.expiresAt)),
  };
}

export async function commandOrigin(db: D1Database, commandId: string, active = true): Promise<Principal> {
  const row = await db
    .prepare('SELECT data, status FROM agent_commands WHERE id = ?')
    .bind(commandId)
    .first<{ data: string; status: string }>();
  if (!row || (active && ['complete', 'failed', 'cancelled', 'cancelling'].includes(row.status)))
    throw new HttpError(409, 'Task is not active');
  const command = JSON.parse(row.data);
  const parsed = principalSchema.safeParse(command.principal);
  if (!parsed.success) throw new HttpError(403, 'Task has no authorized originator');
  const origin = await currentPrincipal(db, parsed.data);
  if (active) {
    requireScope(origin, 'tasks:manage');
    requireScope(origin, 'prompts:read');
    if (command.context?.productionId) requireScope(origin, 'productions:read');
  }
  return origin;
}

export async function commandPrincipal(
  db: D1Database,
  commandId: string,
  executor: Principal,
): Promise<Principal> {
  const origin = await commandOrigin(db, commandId);
  executor = await currentPrincipal(db, executor);
  return {
    ...executor,
    kind: 'agent',
    scopes: scopes.filter((scope) => hasScope(executor, scope) && hasScope(origin, scope)),
  };
}
