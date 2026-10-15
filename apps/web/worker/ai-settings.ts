import {
  type AiStatus,
  aiStatusSchema,
  aiUpdateSchema,
  hasScope,
  type Principal,
  type RuntimeRequest,
} from '@his-fm/contracts';
import { hub } from './agent-runtime';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readJson } from './production-body';

export async function runtimeConfiguration(
  env: Env,
  input: RuntimeRequest = { kind: 'settings.read' },
): Promise<AiStatus> {
  const response = await hub(env).fetch(
    new Request('https://hub/runtime-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  if (!response.ok) throw new HttpError(response.status, '主控配置暂不可用，请检查连接或刷新后重试');
  const result = aiStatusSchema.safeParse(await response.json());
  if (!result.success) throw new HttpError(502, '主控返回的配置状态无效');
  return result.data;
}

export async function routeAiSettings(request: Request, env: Env, actor: Principal) {
  if (request.method === 'GET') {
    requireScope(actor, 'settings:read');
    return json({ config: await runtimeConfiguration(env) });
  }
  if (request.method !== 'PUT') throw new HttpError(405, '不支持这个请求方式');
  const input = await readJson(request, aiUpdateSchema);
  if (input.settings) requireScope(actor, 'settings:write');
  if (input.credentials) requireScope(actor, 'credentials:write');
  const config = await runtimeConfiguration(env, { kind: 'settings.update', input });
  return json(hasScope(actor, 'settings:read') ? { config } : { version: config.version });
}
