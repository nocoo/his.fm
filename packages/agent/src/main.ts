import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebsiteClient } from './client.ts';
import { configuredModels, environmentSchema, loadConfig, website } from './config.ts';
import { openRuntime } from './runtime.ts';
import { acquireInstance, RuntimeStore } from './store.ts';
import { RuntimeTransport } from './transport.ts';

export const dependencies = {
  loadConfig,
  configuredModels,
  website,
  mkdir,
  acquireInstance,
  RuntimeStore,
  RuntimeTransport,
  WebsiteClient,
  openRuntime,
};
export function parseArguments(args: string[]) {
  if (args[0] !== 'start' || (args.length !== 1 && (args.length !== 3 || args[1] !== '--environment')))
    throw new Error('用法：start [--environment local|production]');
  const parsed = environmentSchema.safeParse(args[2] ?? 'local');
  if (!parsed.success) throw new Error('环境必须是 local 或 production。');
  return parsed.data;
}

export async function main(
  args: string[],
  services = dependencies,
  directory = join(homedir(), '.config/his.fm/runtime'),
) {
  const environment = parseArguments(args);
  const config = await services.loadConfig();
  const site = services.website(config, environment);
  const identity = `${new URL(site.baseUrl).origin}|${site.stationId}`;
  const path = join(directory, createHash('sha256').update(identity).digest('hex'));
  await services.mkdir(path, { recursive: true, mode: 0o700 });
  const unlock = services.acquireInstance(path);
  let store: RuntimeStore | undefined;
  let transport: RuntimeTransport | undefined;
  let runtime: Awaited<ReturnType<typeof openRuntime>> | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    transport?.stop();
    try {
      await runtime?.close();
    } finally {
      store?.close();
      unlock();
    }
  };
  try {
    store = new services.RuntimeStore(join(path, 'transport.sqlite'), identity);
    if (
      existsSync(join(path, 'pi.sqlite')) &&
      !existsSync(join(path, 'frogie.sqlite')) &&
      (store.database
        .prepare("SELECT 1 FROM commands WHERE status NOT IN ('complete','failed','cancelled') LIMIT 1")
        .get() ||
        store.pending().length)
    )
      throw new Error('Resolve pending legacy work before starting Frogie.');
    transport = new services.RuntimeTransport(store, site);
    runtime = await services.openRuntime({
      config,
      models: services.configuredModels(config),
      databasePath: join(path, 'frogie.sqlite'),
      store,
      transport,
      client: new services.WebsiteClient(site),
    });
    transport.start();
    console.log(`主控已启动（${environment === 'local' ? '本地' : '生产'}），等待网站指令。`);
    return { close, runtime, transport };
  } catch {
    await close();
    throw new Error('主控启动失败，配置与持久状态未删除。');
  }
}
