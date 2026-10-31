import { editorialPriority } from '../src/shared/channel';
import type { Actor } from '../src/shared/production';
import { requireScope } from './authorization';
import { HttpError, json } from './http';

export async function routeChannel(request: Request, _env: Env, actor: Actor): Promise<Response> {
  if (request.method === 'GET') {
    requireScope(actor, 'prompts:read');
    return json({ priority: editorialPriority });
  }
  requireScope(actor, 'prompts:write');
  throw new HttpError(405, '旧提示词字段已只读，请使用 /channel/prompt-slots');
}
