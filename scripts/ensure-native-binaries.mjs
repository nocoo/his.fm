import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPlatformInstallTargets, detectHost, isPackageInstalledAt } from './native-platform-deps.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const installAttempts = 5;
const installBackoffMs = [0, 4_000, 12_000, 24_000, 40_000];

function loadLockfile() {
  return JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
}

function missingInstallTargets(host) {
  const targets = collectPlatformInstallTargets(loadLockfile().packages ?? {}, host);
  return targets.filter(
    (target) => !isPackageInstalledAt(target.installDir, target.name, repoRoot, target.version),
  );
}

function installInDirectory(installDir, packages) {
  if (!packages.length) return;
  const cwd = join(repoRoot, installDir);
  const spec = packages.map(({ name, version }) => `${name}@${version}`).join(' ');
  let lastError;
  for (let attempt = 0; attempt < installAttempts; attempt++) {
    if (installBackoffMs[attempt]) {
      execSync(`sleep ${Math.ceil(installBackoffMs[attempt] / 1000)}`, { stdio: 'inherit' });
    }
    try {
      execSync(`npm install --no-save --include=optional ${spec}`, {
        cwd,
        stdio: 'inherit',
        env: { ...process.env, npm_config_include: 'optional' },
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function installTargets(targets) {
  const byDir = new Map();
  for (const target of targets) {
    const list = byDir.get(target.installDir) ?? [];
    list.push(target);
    byDir.set(target.installDir, list);
  }
  for (const [installDir, list] of byDir) {
    const label = installDir === '.' ? 'root' : installDir;
    console.log(`Installing ${list.length} platform package(s) in ${label}`);
    installInDirectory(installDir, list);
  }
}

function runStep(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
}

function verifyNativeBinariesLoad() {
  runStep('biome', 'npm', ['exec', '--', 'biome', '--version']);
  runStep('workerd', 'npm', ['exec', '-w', '@his-fm/web', '--', 'workerd', '--version']);
  runStep('typescript', 'npm', ['exec', '-w', '@his-fm/contracts', '--', 'tsc', '--version']);
  runStep('vite', 'npm', ['exec', '-w', '@his-fm/web', '--', 'vite', '--version']);
}

function rebuildWorkerd() {
  execSync('npm rebuild workerd --workspaces --if-present', { cwd: repoRoot, stdio: 'inherit' });
}

function main() {
  const host = detectHost();
  console.log(`ensure-native-binaries: host=${host.os}/${host.arch}${host.libc ? `/${host.libc}` : ''}`);

  let missing = missingInstallTargets(host);
  if (missing.length) {
    console.log(
      `Missing ${missing.length} platform package(s): ${missing.map((t) => `${t.name}@${t.version} (${t.installDir})`).join(', ')}`,
    );
    installTargets(missing);
    missing = missingInstallTargets(host);
    if (missing.length) {
      throw new Error(
        `Still missing after install: ${missing.map((t) => `${t.name}@${t.version}@${t.installDir}`).join(', ')}`,
      );
    }
  } else {
    console.log('All lockfile platform optional dependencies are present.');
  }

  rebuildWorkerd();
  verifyNativeBinariesLoad();
  console.log('Native binary smoke checks passed.');
}

main();
