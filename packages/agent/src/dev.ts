import { type ChildProcess, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, website } from './config.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export const devServices = {
  loadConfig,
  website,
  fetch,
  spawn: (args: string[]) =>
    spawn(process.execPath, args, {
      cwd: args[0] === 'scripts/dev.mjs' ? `${root}/apps/web` : root,
      stdio: 'inherit',
      detached: true,
    }),
  kill: (pid: number) => {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  },
  delay: (ms: number) => delay(ms),
  version: async () =>
    (
      JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
        version: string;
      }
    ).version,
  log: (message: string) => console.log(message),
};

export async function startDevelopment(services = devServices) {
  const config = await services.loadConfig();
  const site = services.website(config, 'local');
  const origin = new URL(site.baseUrl).origin;
  if (origin !== 'http://127.0.0.1:7056')
    throw new Error('一键开发只使用 http://127.0.0.1:7056，生产运行请单独启动。');
  const expectedVersion = await services.version();
  const children: ChildProcess[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const child of children) if (child.pid && child.exitCode === null) services.kill(child.pid);
  };
  const run = (args: string[]) => {
    const child = services.spawn(args);
    children.push(child);
    child.once('error', close);
    child.once('exit', close);
    return child;
  };
  const health = async () => {
    let response: Response;
    try {
      response = await services.fetch(`${origin}/api/live`, {
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
      });
    } catch {
      return false;
    }
    if (!response.ok) throw new Error('7056 服务未就绪，请先检查现有开发服务。');
    const data = (await response.json()) as { service?: string; version?: string; status?: string };
    if (data.service !== 'his.fm' || data.version !== expectedVersion || data.status !== 'ok')
      throw new Error('7056 已被不同服务或版本占用，请先停止原进程。');
    return true;
  };
  try {
    if (!(await health())) {
      run(['scripts/dev.mjs']);
      let ready = false;
      for (let attempt = 0; attempt < 60 && !closed; attempt++) {
        await services.delay(1000);
        if (await health()) {
          ready = true;
          break;
        }
      }
      if (!ready) throw new Error('本地网站未能在等待期限内启动。');
    } else services.log('复用当前本地网站；退出不会停止它。');
    const login = await services.fetch(`${origin}/admin/api/dev-login`, {
      method: 'POST',
      headers: { Origin: origin },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!login.ok) throw new Error('本地工作室登录失败。');
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('本地工作室缺少会话。');
    const agentOnline = async () => {
      const response = await services.fetch(`${origin}/admin/api/agent/snapshot`, {
        headers: { Cookie: cookie, Origin: origin },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('本地 AgentHub 未就绪。');
      return ((await response.json()) as { online: boolean }).online;
    };
    if (await agentOnline()) services.log('复用当前 Local 主控；配置、令牌与任务保持不变。');
    else {
      run(['--experimental-strip-types', 'packages/agent/src/cli.ts', 'start', '--environment', 'local']);
      let online = false;
      for (let attempt = 0; attempt < 40 && !closed; attempt++) {
        await services.delay(1000);
        if (await agentOnline()) {
          online = true;
          break;
        }
      }
      if (!online) throw new Error('本机主控未能连接，请检查 Local 令牌、站点绑定和 agent:debug。');
    }
    services.log('本地开发就绪：https://hisfm.dev.hexly.ai · 调试：npm run agent:debug');
    return { close, children };
  } catch (error) {
    close();
    throw error;
  }
}

export async function runDevelopment(start = startDevelopment, host = process) {
  try {
    const development = await start();
    host.once('SIGINT', development.close);
    host.once('SIGTERM', development.close);
  } catch {
    console.error('本地开发启动失败，请核对端口、配置与 Local 站点绑定。');
    host.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runDevelopment();
