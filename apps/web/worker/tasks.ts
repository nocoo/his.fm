import { commandSchema, hasScope, type Principal } from '@his-fm/contracts';
import { hub } from './agent-runtime';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readJson } from './production-body';

export const taskInputSchema = commandSchema.omit({ createdAt: true, principal: true });

export async function routeTasks(
  request: Request,
  env: Env,
  path: string,
  actor: Principal,
): Promise<Response> {
  const match = /^\/tasks(?:\/([^/]+)(\/cancel)?)?$/.exec(path);
  if (!match) throw new HttpError(404, 'Task endpoint does not exist');
  const id = match[1];
  if (!id && request.method === 'POST') {
    requireScope(actor, 'tasks:submit');
    requireScope(actor, 'tasks:manage');
    requireScope(actor, 'prompts:read');
    const input = await readJson(request, taskInputSchema);
    if (input.context?.productionId) requireScope(actor, 'productions:read');
    return hub(env).fetch('https://hub/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, principal: actor }),
    });
  }
  requireScope(actor, match[2] ? 'tasks:cancel' : 'tasks:read');
  const all = hasScope(actor, 'tasks:manage');
  if (!id) {
    if (request.method !== 'GET') throw new HttpError(405, 'Tasks support GET and POST');
    const result = await env.DB.prepare(
      "SELECT data, status, detail FROM agent_commands WHERE ? = 1 OR json_extract(data, '$.principal.tokenId') = ? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(Number(all), actor.tokenId ?? '')
      .all<{ data: string; status: string; detail: string }>();
    return json({ tasks: result.results.map(({ data, ...state }) => ({ ...JSON.parse(data), ...state })) });
  }
  const row = await env.DB.prepare('SELECT data, status, detail FROM agent_commands WHERE id = ?')
    .bind(id)
    .first<{ data: string; status: string; detail: string }>();
  if (!row || (!all && JSON.parse(row.data).principal?.tokenId !== actor.tokenId))
    throw new HttpError(404, 'Task does not exist');
  if (match[2]) {
    if (request.method !== 'POST') throw new HttpError(405, 'Cancel requires POST');
    return hub(env).fetch('https://hub/task-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }
  if (request.method !== 'GET') throw new HttpError(405, 'Task details are read-only');
  const messages = await env.DB.prepare(
    "SELECT data FROM agent_events WHERE type = 'message' AND json_extract(data, '$.message.commandId') = ? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(id)
    .all<{ data: string }>();
  return json({
    task: { ...JSON.parse(row.data), status: row.status, detail: row.detail },
    messages: messages.results.reverse().map((item) => JSON.parse(item.data).message),
  });
}
