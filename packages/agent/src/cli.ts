import { pathToFileURL } from 'node:url';
import { main } from './main.ts';

export async function runCli(args: string[], start = main, host = process) {
  try {
    const runtime = await start(args);
    const close = () => {
      void runtime.close().catch(() => {
        host.exitCode = 1;
      });
    };
    host.once('SIGINT', close);
    host.once('SIGTERM', close);
  } catch {
    console.error('主控未能启动，请检查命令、网站令牌与本机配置。');
    host.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runCli(process.argv.slice(2));
