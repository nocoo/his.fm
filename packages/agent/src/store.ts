import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AgentCommand,
  type AgentFrame,
  agentFrameSchema,
  maxFrameBytes,
  type PageContext,
  type ServerFrame,
} from '@his-fm/contracts';

export type CommandState = 'queued' | 'working' | 'waiting' | 'complete' | 'failed' | 'cancelled';
export type InputRecord = { id: string; commandId: string; content: string; done: number };

export function acquireInstance(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const lock = new DatabaseSync(join(directory, 'instance.sqlite'));
  try {
    lock.exec('BEGIN IMMEDIATE');
  } catch {
    lock.close();
    throw new Error('同一网站的主控已在运行。');
  }
  return () => lock.close();
}

export function frameId(frame: Exclude<AgentFrame, { type: 'ping' }>) {
  switch (frame.type) {
    case 'accepted':
      return `accepted:${frame.commandId}`;
    case 'message':
      return frame.message.id;
    case 'proposal':
      return frame.proposal.id;
    case 'operation':
      return frame.operation.id;
    default:
      return frame.id;
  }
}

export class RuntimeStore {
  readonly database: DatabaseSync;
  constructor(path: string, identity: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inputs (id TEXT PRIMARY KEY, commandId TEXT NOT NULL, content TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, payload TEXT NOT NULL, acked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
    const previous = this.get<string>('identity');
    if (previous && previous !== identity) {
      this.database.close();
      throw new Error('持久状态属于另一个网站。');
    }
    this.set('identity', identity);
  }
  get<Value>(key: string): Value | null {
    const row = this.database.prepare('SELECT value FROM metadata WHERE id=?').get(key);
    return row ? (JSON.parse(row.value as string) as Value) : null;
  }
  set(key: string, value: unknown) {
    this.database
      .prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }
  atomic<Output>(action: () => Output): Output {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  enqueue(frame: Exclude<AgentFrame, { type: 'ping' }>) {
    const payload = JSON.stringify(agentFrameSchema.parse(frame));
    if (Buffer.byteLength(payload) > maxFrameBytes) throw new Error('持久事件超过实时帧预算。');
    const id = frameId(frame);
    const old = this.database.prepare('SELECT payload FROM outbox WHERE id=?').get(id);
    if (old && old.payload !== payload) throw new Error('持久事件 ID 不得复用于不同内容。');
    this.database.prepare('INSERT OR IGNORE INTO outbox(id,payload) VALUES (?,?)').run(id, payload);
  }
  pending(): Exclude<AgentFrame, { type: 'ping' }>[] {
    return this.database
      .prepare('SELECT payload FROM outbox WHERE acked=0 ORDER BY rowid LIMIT 256')
      .all()
      .map((row) => JSON.parse(row.payload as string));
  }
  event(id: string): Exclude<AgentFrame, { type: 'ping' }> | null {
    const row = this.database.prepare('SELECT payload FROM outbox WHERE id=?').get(id);
    return row ? JSON.parse(row.payload as string) : null;
  }
  acknowledge(id: string) {
    this.database.prepare('UPDATE outbox SET acked=1 WHERE id=?').run(id);
  }
  command(id: string): { command: AgentCommand; status: CommandState } | null {
    const row = this.database.prepare('SELECT payload,status FROM commands WHERE id=?').get(id);
    return row ? { command: JSON.parse(row.payload as string), status: row.status as CommandState } : null;
  }
  receive(command: AgentCommand) {
    this.atomic(() => {
      const old = this.command(command.id);
      if (old && JSON.stringify(old.command) !== JSON.stringify(command))
        throw new Error('指令 ID 的内容发生变化。');
      this.database
        .prepare('INSERT OR IGNORE INTO commands VALUES (?,?,?)')
        .run(command.id, JSON.stringify(command), 'queued');
      this.input(`command:${command.id}`, command.id, JSON.stringify({ actor: 'owner', command }));
      this.enqueue({ type: 'accepted', commandId: command.id });
      this.database.prepare('UPDATE outbox SET acked=0 WHERE id=?').run(`accepted:${command.id}`);
    });
  }
  input(id: string, commandId: string, content: string) {
    const old = this.database.prepare('SELECT content FROM inputs WHERE id=?').get(id);
    if (old && old.content !== content) throw new Error('模型输入 ID 的内容发生变化。');
    this.database
      .prepare('INSERT OR IGNORE INTO inputs(id,commandId,content) VALUES (?,?,?)')
      .run(id, commandId, content);
  }
  next(): InputRecord | null {
    return (
      (this.database
        .prepare(`SELECT inputs.* FROM inputs JOIN commands ON commands.id=inputs.commandId
      WHERE inputs.done=0 AND commands.status NOT IN ('cancelled','failed','complete') ORDER BY inputs.rowid LIMIT 1`)
        .get() as InputRecord | undefined) ?? null
    );
  }
  finishInput(id: string) {
    this.database.prepare('UPDATE inputs SET done=1 WHERE id=?').run(id);
  }
  hasInput(commandId: string) {
    return !!this.database
      .prepare('SELECT id FROM inputs WHERE commandId=? AND done=0 LIMIT 1')
      .get(commandId);
  }
  hasPendingEffect(commandId: string) {
    return !!this.database
      .prepare(`SELECT outbox.id FROM outbox LEFT JOIN receipts ON receipts.id=outbox.id
      WHERE receipts.id IS NULL AND ((json_extract(outbox.payload,'$.operation.commandId')=? AND json_extract(outbox.payload,'$.type')='operation')
      OR (json_extract(outbox.payload,'$.proposal.commandId')=? AND json_extract(outbox.payload,'$.type')='proposal')) LIMIT 1`)
      .get(commandId, commandId);
  }
  state(commandId: string, status: Exclude<CommandState, 'queued'>, detail: string, eventId: string) {
    this.atomic(() => {
      this.database.prepare('UPDATE commands SET status=? WHERE id=?').run(status, commandId);
      this.enqueue({ type: 'command.state', id: eventId, commandId, status, detail });
    });
  }
  context(context: PageContext) {
    const previous = this.get<PageContext>(`context:${context.tabId}`);
    if (
      previous &&
      (previous.pageEpoch > context.pageEpoch ||
        (previous.pageEpoch === context.pageEpoch && previous.seq >= context.seq))
    )
      return;
    this.set(`context:${context.tabId}`, context);
    this.set('latestContext', context);
  }
  receipt(frame: Extract<ServerFrame, { type: 'operation.result' | 'proposal.ack' }>) {
    this.atomic(() => {
      this.database
        .prepare('INSERT OR IGNORE INTO receipts VALUES (?,?)')
        .run(frame.id, JSON.stringify(frame));
      this.acknowledge(frame.id);
    });
  }
  result(id: string): Extract<ServerFrame, { type: 'operation.result' | 'proposal.ack' }> | null {
    const row = this.database.prepare('SELECT payload FROM receipts WHERE id=?').get(id);
    return row ? JSON.parse(row.payload as string) : null;
  }
  close() {
    this.database.close();
  }
}
