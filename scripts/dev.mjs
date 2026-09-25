import { spawn, spawnSync } from 'node:child_process';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

for (const args of [
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'migrations',
    'apply',
    'his-fm',
    '--local',
    '--config',
    'wrangler.local.jsonc',
  ],
  ['scripts/seed-local.mjs'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
