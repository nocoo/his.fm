import { hasScope, type Principal, type Scope } from '@his-fm/contracts';
import { HttpError } from './http';

export function requireScope(actor: Principal, scope: Scope): void {
  if (!hasScope(actor, scope)) throw new HttpError(403, `Missing scope: ${scope}`);
}
