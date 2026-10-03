import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentCommand, AgentOperation, ServerFrame } from '@his-fm/contracts';
import type { Actor, Production } from '../src/shared/production';
import { digest, requireCommand } from './agent-runtime-store';
import { routeAudio, triggerAudio } from './audio-routes';
import { HttpError } from './http';
import { routeProductions } from './production';

export interface OperationIdentity {
  tokenId: string;
  stationVersion: number;
  generation: string;
  expiresAt: number;
}
interface OperationContext extends OperationIdentity {
  operation: AgentOperation;
}
const operations = new AsyncLocalStorage<OperationContext>();
type Receipt = Extract<ServerFrame, { type: 'operation.result' }>;

export function operationFence(db: D1Database): D1PreparedStatement[] {
  const context = operations.getStore();
  if (!context) return [];
  return [
    db
      .prepare(`INSERT OR REPLACE INTO agent_write_fence (id, valid) VALUES (1, CASE WHEN EXISTS (
    SELECT 1 FROM agent_station JOIN agent_tokens ON agent_tokens.id = agent_station.token_id
    JOIN agent_commands ON agent_commands.id = ?
    WHERE agent_station.id = 1 AND agent_station.token_id = ? AND agent_station.version = ?
    AND generation = ? AND lease_until > ? AND ? > ?
    AND revoked_at IS NULL AND expires_at > ? AND agent_commands.status NOT IN ('complete', 'failed', 'cancelled', 'cancelling')
  ) THEN 1 ELSE 0 END)`)
      .bind(
        context.operation.commandId,
        context.tokenId,
        context.stationVersion,
        context.generation,
        Date.now(),
        context.expiresAt,
        Date.now(),
        new Date().toISOString(),
      ),
  ];
}

export function operationReceipt(
  db: D1Database,
  production: Production,
  responseStatus?: number,
): D1PreparedStatement[] {
  const context = operations.getStore();
  if (!context) return [];
  const status =
    responseStatus ??
    (context.operation.kind === 'production.create'
      ? 201
      : context.operation.kind === 'audio.request'
        ? 202
        : 200);
  const response: Receipt = {
    type: 'operation.result',
    id: context.operation.id,
    ok: true,
    status,
    result: { production },
  };
  return [
    db
      .prepare('UPDATE agent_receipts SET response = ? WHERE id = ? AND response IS NULL AND changes() = 1')
      .bind(JSON.stringify(response), context.operation.id),
  ];
}

export async function readReceipt(db: D1Database, id: string) {
  const saved = await db
    .prepare('SELECT response FROM agent_receipts WHERE id = ?')
    .bind(id)
    .first<{ response: string | null }>();
  if (!saved) throw new HttpError(404, '操作回执不存在');
  return saved.response ? (JSON.parse(saved.response) as Receipt) : null;
}

export async function persistOperationFailure(
  db: D1Database,
  operation: AgentOperation,
  error: HttpError,
): Promise<Receipt> {
  const hash = await digest(operation);
  const receipt: Receipt = {
    type: 'operation.result',
    id: operation.id,
    ok: false,
    status: error.status,
    result: { error: error.message },
  };
  await db
    .prepare(
      'INSERT INTO agent_receipts (id, hash, command_id, response) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM agent_commands WHERE id = ?) ON CONFLICT(id) DO UPDATE SET response = excluded.response WHERE agent_receipts.hash = excluded.hash AND agent_receipts.response IS NULL',
    )
    .bind(operation.id, hash, operation.commandId, JSON.stringify(receipt), operation.commandId)
    .run();
  return receipt;
}

export async function executeOperation(
  env: Env,
  actor: Actor,
  identity: OperationIdentity,
  operation: AgentOperation,
): Promise<Receipt> {
  const hash = await digest(operation);
  const previous = await env.DB.prepare('SELECT hash, response FROM agent_receipts WHERE id = ?')
    .bind(operation.id)
    .first<{ hash: string; response: string | null }>();
  if (previous && previous.hash !== hash) throw new HttpError(409, '操作 ID 已用于不同内容');
  if (previous?.response) {
    const receipt = JSON.parse(previous.response) as Receipt;
    if (operation.kind === 'audio.request' && receipt.ok) {
      const result = receipt.result as { production: Production };
      if (result.production.audioJob) {
        const job = await env.DB.prepare('SELECT status FROM audio_jobs WHERE id = ?')
          .bind(result.production.audioJob.id)
          .first<{ status: string }>();
        if (job?.status === 'queued') await triggerAudio(env, result.production.audioJob.id);
      }
    }
    return receipt;
  }
  await requireCommand(env.DB, operation.commandId, true);
  const command = await env.DB.prepare('SELECT data FROM agent_commands WHERE id = ?')
    .bind(operation.commandId)
    .first<{ data: string }>();
  const savedCommand = JSON.parse(command?.data ?? '{}') as AgentCommand;
  const scope = savedCommand.context;
  if (operation.kind === 'production.create') {
    if (scope?.productionId) throw new HttpError(403, '当前指令不允许创建其他制作任务');
  } else {
    if (scope?.productionId !== operation.productionId) {
      const created =
        !scope?.productionId &&
        (await env.DB.prepare(
          "SELECT id FROM agent_receipts WHERE command_id = ? AND json_extract(response, '$.ok') = 1 AND json_extract(response, '$.status') = 201 AND json_extract(response, '$.result.production.id') = ? LIMIT 1",
        )
          .bind(operation.commandId, operation.productionId)
          .first());
      if (!created) throw new HttpError(403, '操作超出指令的制作任务范围');
    }
    if (operation.kind === 'audio.request') {
      const text = savedCommand.text;
      if (
        !/(?:生成|制作|合成|重录|录制|重生成).{0,16}(?:音频|配音|朗读|录音)|(?:generate|create|synthesize|regenerate|record).{0,24}(?:audio|narration|voiceover)/iu.test(
          text,
        ) ||
        /(?:不要|禁止|别|不需要|不必|暂不|先不|仅试听|只试听|试听|预览)|\b(?:not|don't|never|preview)\b/iu.test(
          text,
        )
      )
        throw new HttpError(403, '生成音频必须来自明确的人工生成指令');
    }
    if (
      operation.kind === 'production.patch' &&
      scope?.field &&
      scope.draft &&
      scope.draft.value !== scope.draft.baseValue
    ) {
      const field = scope.field.field;
      let overlaps = false;
      if (field.startsWith('source.')) {
        if (Object.hasOwn(operation.changes, 'sources')) {
          const sources = operation.changes.sources;
          const source = Array.isArray(sources)
            ? sources.find((value) => value?.id === scope.field?.sourceId)
            : null;
          overlaps = source?.[field.slice('source.'.length)] !== scope.draft.baseValue;
        }
      } else
        overlaps =
          Object.hasOwn(operation.changes, field) && operation.changes[field] !== scope.draft.baseValue;
      if (overlaps) throw new HttpError(409, '未保存字段只能提交草稿建议，不能替代人工保存');
    }
  }
  await env.DB.prepare(
    'INSERT INTO agent_receipts (id, hash, command_id) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(operation.id, hash, operation.commandId)
    .run();
  let path = '/productions';
  let method = 'POST';
  let body: unknown;
  if (operation.kind === 'production.create') body = operation.brief;
  else {
    path += `/${encodeURIComponent(operation.productionId)}`;
    if (operation.kind === 'production.patch') {
      method = 'PUT';
      body = { ...operation.changes, version: operation.version };
    } else if (operation.kind === 'production.action') {
      path += '/actions';
      body = { action: operation.action, version: operation.version };
    } else {
      path += '/audio';
      body = { ...operation.options, version: operation.version };
    }
  }
  const request = new Request(`https://his.fm${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let receipt: Receipt;
  try {
    const response = await operations.run(
      { ...identity, operation },
      async () =>
        (await routeAudio(request, env, path, actor)) ?? (await routeProductions(request, env, path, actor)),
    );
    if (!response) throw new HttpError(404, '操作不存在');
    receipt = {
      type: 'operation.result',
      id: operation.id,
      ok: response.ok,
      status: response.status,
      result: await response.json(),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('CHECK constraint failed: valid = 1'))
      throw new HttpError(409, '主控租约或指令已失效');
    if (!(error instanceof HttpError)) throw error;
    const committed = await readReceipt(env.DB, operation.id);
    if (committed) return committed;
    receipt = {
      type: 'operation.result',
      id: operation.id,
      ok: false,
      status: error.status,
      result: { error: error.message },
    };
  }
  await env.DB.prepare('UPDATE agent_receipts SET response = ? WHERE id = ? AND response IS NULL')
    .bind(JSON.stringify(receipt), operation.id)
    .run();
  return (await readReceipt(env.DB, operation.id)) as Receipt;
}
