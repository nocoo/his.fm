import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const timeoutMs = Number(process.env.HISFM_GATE_TIMEOUT_MS || 180000);
const steps = ['test:coverage', 'lint', 'typecheck'];
let snapshot = '';
let child = null;
let settled = false;

function fail(message) {
  console.error(`pre-commit: ${message}`);
  process.exitCode = 1;
}

function killChild(signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
}

function removeSnapshot() {
  if (!snapshot) return;
  const target = snapshot;
  snapshot = '';
  rmSync(target, { recursive: true, force: true });
}

function finish(code) {
  if (settled) return;
  settled = true;
  killChild('SIGKILL');
  try {
    removeSnapshot();
  } catch (error) {
    console.error(`pre-commit: cleanup failed: ${error instanceof Error ? error.message : error}`);
    process.exit(code || 1);
  }
  process.exit(code);
}

process.on('SIGINT', () => finish(130));
process.on('SIGTERM', () => finish(143));
process.on('SIGHUP', () => finish(129));

function run(args, cwd, env) {
  return new Promise((resolve) => {
    let timer;
    try {
      child = spawn('npm', args, { cwd, env, stdio: 'inherit', detached: true });
    } catch (error) {
      console.error(`pre-commit: failed to start npm: ${error instanceof Error ? error.message : error}`);
      resolve(127);
      return;
    }
    timer = setTimeout(() => {
      killChild('SIGKILL');
      console.error(`pre-commit: npm ${args.join(' ')} exceeded ${timeoutMs}ms`);
      resolve(124);
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      child = null;
      console.error(`pre-commit: failed to start npm: ${error.message}`);
      resolve(127);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      child = null;
      resolve(signal ? 128 : (code ?? 1));
    });
  });
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

try {
  if (!existsSync(join(root, 'node_modules'))) fail('node_modules is required');
  if (!process.exitCode) {
    snapshot = mkdtempSync(join(tmpdir(), 'hisfm-l1-'));
    execFileSync('git', ['checkout-index', '--all', `--prefix=${snapshot}/`], {
      cwd: root,
      stdio: 'inherit',
    });
    if (!existsSync(join(snapshot, 'package.json'))) fail('staged package.json is required');
    const stagedHelper = join(snapshot, 'scripts/l1-snapshot.mjs');
    if (!existsSync(stagedHelper)) fail('staged scripts/l1-snapshot.mjs is required');
    try {
      const { linkSnapshotNodeModules } = await import(pathToFileURL(stagedHelper).href);
      linkSnapshotNodeModules(root, snapshot);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'snapshot link failed');
    }
  }
  if (!process.exitCode) {
    const env = { ...process.env, XDG_CACHE_HOME: join(snapshot, '.cache') };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    let status = 0;
    for (const step of steps) {
      const code = await run(['run', step], snapshot, env);
      if (code !== 0 && status === 0) status = code;
    }
    process.exitCode = status;
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'gate failed');
}

finish(process.exitCode ?? 1);
