import type { AgentCommand, AgentFrame, DraftProposal, PageContext, ServerFrame } from '@his-fm/contracts';
import { HttpError } from './http';
import { getProduction } from './production-store';

export interface Station {
  tokenId: string;
  stationId: string;
  version: number;
  generation: string | null;
  leaseUntil: number;
}

export async function digest(value: unknown): Promise<string> {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, content]) => [key, canonical(content)]),
      );
    return item;
  };
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function station(db: D1Database) {
  return db
    .prepare(
      'SELECT token_id AS tokenId, station_id AS stationId, version, generation, lease_until AS leaseUntil FROM agent_station WHERE id = 1',
    )
    .first<Station>();
}

function requireContextReference(context: PageContext) {
  if (
    context.field &&
    (context.field.productionId !== context.productionId ||
      (context.field.field.startsWith('source.') &&
        (!context.sourceId || context.field.sourceId !== context.sourceId)))
  )
    throw new HttpError(400, '页面字段引用不匹配');
}

export async function saveContext(db: D1Database, context: PageContext) {
  requireContextReference(context);
  const encoded = JSON.stringify(context);
  const previous = await db
    .prepare('SELECT epoch, seq, data FROM agent_contexts WHERE tab_id = ?')
    .bind(context.tabId)
    .first<{ epoch: number; seq: number; data: string }>();
  if (
    previous &&
    (context.pageEpoch < previous.epoch ||
      (context.pageEpoch === previous.epoch && context.seq <= previous.seq))
  ) {
    if (previous.data === encoded) return false;
    throw new HttpError(409, '页面上下文已过期');
  }
  const result = await db
    .prepare(
      'INSERT INTO agent_contexts (tab_id, epoch, seq, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tab_id) DO UPDATE SET epoch = excluded.epoch, seq = excluded.seq, data = excluded.data, updated_at = excluded.updated_at WHERE excluded.epoch > epoch OR (excluded.epoch = epoch AND excluded.seq > seq)',
    )
    .bind(context.tabId, context.pageEpoch, context.seq, encoded, Date.now())
    .run();
  if (!result.meta.changes) throw new HttpError(409, '页面上下文已过期');
  return true;
}

export async function enqueue(db: D1Database, input: Omit<AgentCommand, 'createdAt'>) {
  const hash = await digest(input);
  if (input.context) requireContextReference(input.context);
  const existing = await db.prepare('SELECT hash FROM agent_commands WHERE id = ?').bind(input.id).first();
  if (!existing && input.context?.productionId) {
    const production = await getProduction(db, input.context.productionId);
    if (input.context.sourceId && !production.sources.some((source) => source.id === input.context?.sourceId))
      throw new HttpError(400, '指令来源不存在');
  }
  const command = { ...input, createdAt: new Date().toISOString() };
  const result = await db
    .prepare(
      'INSERT INTO agent_commands (id, hash, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    )
    .bind(input.id, hash, JSON.stringify(command), command.createdAt)
    .run();
  const saved = await db
    .prepare('SELECT hash, data FROM agent_commands WHERE id = ?')
    .bind(input.id)
    .first<{ hash: string; data: string }>();
  if (saved?.hash !== hash) throw new HttpError(409, '指令 ID 已用于不同内容');
  return { command: JSON.parse(saved.data) as AgentCommand, inserted: result.meta.changes === 1 };
}

export async function requireCommand(db: D1Database, id: string, active = false) {
  const command = await db
    .prepare('SELECT status FROM agent_commands WHERE id = ?')
    .bind(id)
    .first<{ status: string }>();
  if (!command) throw new HttpError(404, '指令不存在');
  if (active && ['complete', 'failed', 'cancelled'].includes(command.status))
    throw new HttpError(409, '指令已结束');
  return command;
}

export async function persistEvent(
  db: D1Database,
  frame: Exclude<AgentFrame, { type: 'ping' | 'accepted' | 'operation' }>,
) {
  const id =
    frame.type === 'message' ? frame.message.id : frame.type === 'proposal' ? frame.proposal.id : frame.id;
  const hash = await digest(frame);
  const previous = await db
    .prepare('SELECT hash FROM agent_events WHERE id = ?')
    .bind(id)
    .first<{ hash: string }>();
  if (previous) {
    if (previous.hash !== hash) throw new HttpError(409, '事件 ID 已用于不同内容');
    return { id, inserted: false };
  }
  if (frame.type === 'message') {
    if (frame.message.role !== 'assistant') throw new HttpError(403, '主控不能冒充用户消息');
    if (await db.prepare('SELECT id FROM agent_commands WHERE id = ?').bind(frame.message.id).first())
      throw new HttpError(409, '消息 ID 与用户指令冲突');
    if (frame.message.commandId) await requireCommand(db, frame.message.commandId);
  }
  if (frame.type === 'command.state') {
    const command = await requireCommand(db, frame.commandId, true);
    if (command.status === 'cancelling' && !['cancelled', 'complete', 'failed'].includes(frame.status))
      throw new HttpError(409, '指令正在取消');
  }
  if (frame.type === 'proposal') {
    const command = await requireCommand(db, frame.proposal.commandId, true);
    if (command.status === 'cancelling') throw new HttpError(409, '指令正在取消');
    const source = await db
      .prepare('SELECT data FROM agent_commands WHERE id = ?')
      .bind(frame.proposal.commandId)
      .first<{ data: string }>();
    const scope = (JSON.parse(source?.data ?? '{}') as AgentCommand).context;
    if (
      (await digest(scope)) !== (await digest(frame.proposal.context)) ||
      (await digest(frame.proposal.context.field)) !== (await digest(frame.proposal.target))
    )
      throw new HttpError(409, '建议引用的页面或字段已过期');
  }
  const statements = [
    db
      .prepare('INSERT INTO agent_events (id, hash, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, hash, frame.type, JSON.stringify(frame), Date.now()),
  ];
  if (frame.type === 'command.state')
    statements.push(
      db
        .prepare('UPDATE agent_commands SET status = ?, detail = ? WHERE id = ?')
        .bind(frame.status, frame.detail, frame.commandId),
    );
  if (frame.type === 'proposal')
    statements.push(
      db
        .prepare('INSERT INTO agent_proposals (id, data) VALUES (?, ?)')
        .bind(id, JSON.stringify(frame.proposal)),
    );
  await db.batch(statements);
  return { id, inserted: true };
}

export async function runtimeSnapshot(
  db: D1Database,
  online: boolean,
): Promise<Extract<ServerFrame, { type: 'snapshot' }>> {
  const [messages, commands, status, proposals] = await db.batch<{
    data: string;
    id: string;
    status: string;
    detail: string;
  }>([
    db.prepare("SELECT data FROM agent_events WHERE type = 'message' ORDER BY rowid DESC LIMIT 200"),
    db.prepare('SELECT id, status, detail, data FROM agent_commands ORDER BY created_at DESC LIMIT 100'),
    db.prepare("SELECT data FROM agent_events WHERE type = 'status' ORDER BY rowid DESC LIMIT 1"),
    db.prepare("SELECT data FROM agent_proposals WHERE status = 'pending' ORDER BY rowid DESC LIMIT 50"),
  ]);
  const commandMessages = commands.results.map((row) => {
    const command = JSON.parse(row.data) as AgentCommand;
    return {
      id: command.id,
      role: 'user' as const,
      text: command.text,
      commandId: command.id,
      createdAt: command.createdAt,
    };
  });
  const snapshot: Extract<ServerFrame, { type: 'snapshot' }> = {
    type: 'snapshot',
    online,
    messages: [
      ...messages.results.map(
        (row) => (JSON.parse(row.data) as Extract<AgentFrame, { type: 'message' }>).message,
      ),
      ...commandMessages,
    ]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-200),
    commands: commands.results.map(({ id, status, detail }) => ({ id, status, detail })),
    conversations: status.results[0]
      ? (JSON.parse(status.results[0].data) as Extract<AgentFrame, { type: 'status' }>).conversations
      : [],
    proposals: proposals.results.map((row) => JSON.parse(row.data) as DraftProposal),
  };
  while (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 240 * 1024) {
    if (snapshot.messages.length) snapshot.messages.shift();
    else if (snapshot.proposals.length) snapshot.proposals.pop();
    else break;
  }
  return snapshot;
}
