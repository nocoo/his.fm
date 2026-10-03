import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { type Environment, environmentSchema, loadConfig } from './config.ts';

export function debugArguments(args: string[]) {
  let environment: Environment = 'local';
  let commandId: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === '--environment') environment = environmentSchema.parse(value);
    else if (key === '--command' && value && value.length <= 160) commandId = value;
    else throw new Error('用法：agent:debug [--environment local|production] [--command ID]');
  }
  return { environment, commandId };
}

export function runtimeDirectory(
  baseUrl: string,
  stationId: string,
  base = join(homedir(), '.config/his.fm/runtime'),
) {
  const identity = `${new URL(baseUrl).origin}|${stationId}`;
  return join(base, createHash('sha256').update(identity).digest('hex'));
}

export function readRuntimeDebug(directory: string, commandId?: string) {
  const file = join(directory, 'transport.sqlite');
  if (!existsSync(file))
    return { state: 'not_started', commands: [], pendingEvents: 0, pendingEffects: 0, inputs: [], tools: [] };
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const commands = database
      .prepare(
        commandId
          ? 'SELECT id, status FROM commands WHERE id = ?'
          : 'SELECT id, status FROM commands ORDER BY rowid DESC LIMIT 20',
      )
      .all(...(commandId ? [commandId] : []));
    if (commandId && !commands.length) throw new Error('没有找到这条本机指令。');
    const inputQuery = commandId
      ? 'SELECT id, done FROM inputs WHERE commandId = ? ORDER BY rowid'
      : 'SELECT id, done FROM inputs ORDER BY rowid DESC LIMIT 30';
    const inputs = database.prepare(inputQuery).all(...(commandId ? [commandId] : []));
    const pendingEvents = database
      .prepare('SELECT count(*) AS count FROM outbox WHERE acked = 0')
      .get()?.count;
    const pendingEffects = database
      .prepare(
        "SELECT count(*) AS count FROM outbox LEFT JOIN receipts ON receipts.id=outbox.id WHERE receipts.id IS NULL AND json_extract(outbox.payload,'$.type') IN ('operation','proposal')",
      )
      .get()?.count;
    const tools: { conversationId: number; name: string; count: number; failures: number }[] = [];
    const piFile = join(directory, 'pi.sqlite');
    if (existsSync(piFile)) {
      const pi = new DatabaseSync(piFile, { readOnly: true });
      try {
        const groups = new Map<string, (typeof tools)[number]>();
        const rows = pi
          .prepare(
            "SELECT conversation_id, record FROM entries WHERE json_extract(record,'$.kind')='pi.tool-result' ORDER BY id DESC LIMIT 1000",
          )
          .all();
        for (const row of rows) {
          const value = JSON.parse(String(row.record)) as {
            model?: { toolName?: string; isError?: boolean }[];
          };
          for (const message of value.model ?? []) {
            if (!message.toolName) continue;
            const key = `${row.conversation_id}:${message.toolName}`;
            const item = groups.get(key) ?? {
              conversationId: Number(row.conversation_id),
              name: message.toolName,
              count: 0,
              failures: 0,
            };
            item.count++;
            item.failures += Number(message.isError === true);
            groups.set(key, item);
          }
        }
        tools.push(...groups.values());
      } finally {
        pi.close();
      }
    }
    return {
      state: 'recorded',
      commands,
      pendingEvents,
      pendingEffects,
      inputs,
      tools,
      toolScope: 'last_1000_tool_results_all_conversations',
    };
  } finally {
    database.close();
  }
}

export async function debugMain(
  args: string[],
  services = { loadConfig, readRuntimeDebug, runtimeDirectory },
) {
  const { environment, commandId } = debugArguments(args);
  const config = await services.loadConfig();
  const site = config.websites[environment];
  console.log(
    JSON.stringify(
      {
        environment,
        ...services.readRuntimeDebug(services.runtimeDirectory(site.baseUrl, site.stationId), commandId),
      },
      null,
      2,
    ),
  );
}

export async function runDebug(args: string[], inspect = debugMain, host = process) {
  try {
    await inspect(args);
  } catch {
    console.error('调试读取失败，请检查环境、指令 ID 和本机状态文件；配置与原始文本未输出。');
    host.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runDebug(process.argv.slice(2));
