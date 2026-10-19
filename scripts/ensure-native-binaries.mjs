import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTarballIntoPackageDir, fetchLockedTarball } from './lockfile-tarball.mjs';
import {
  collectPlatformInstallTargets,
  detectHost,
  isPackageInstalledAt,
  resolvePackageBin,
} from './native-platform-deps.mjs';

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

function packageDir(installDir, name) {
  return join(repoRoot, installDir, 'node_modules', ...name.split('/'));
}

async function installOneFromLock(target) {
  const { installDir, name, resolved, integrity } = target;
  const targetDir = packageDir(installDir, name);
  let lastError;
  for (let attempt = 0; attempt < installAttempts; attempt++) {
    if (installBackoffMs[attempt]) {
      execSync(`sleep ${Math.ceil(installBackoffMs[attempt] / 1000)}`, { stdio: 'inherit' });
    }
    try {
      const tarball = await fetchLockedTarball(resolved, integrity);
      extractTarballIntoPackageDir(tarball, targetDir);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function installTargets(targets) {
  const byDir = new Map();
  for (const target of targets) {
    const list = byDir.get(target.installDir) ?? [];
    list.push(target);
    byDir.set(target.installDir, list);
  }
  for (const [installDir, list] of byDir) {
    const label = installDir === '.' ? 'root' : installDir;
    console.log(`Installing ${list.length} platform package(s) in ${label}`);
    for (const target of list) {
      await installOneFromLock(target);
    }
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

function firstInstallDirWithBin(installDirs, packageName, binRelative) {
  for (const installDir of installDirs) {
    const candidate = join(repoRoot, installDir, 'node_modules', ...packageName.split('/'), binRelative);
    if (existsSync(candidate)) {
      return installDir;
    }
  }
  throw new Error(`Missing local ${packageName}/${binRelative} under ${installDirs.join(', ')}`);
}

function verifyNativeBinariesLoad() {
  const biomeBin = resolvePackageBin(repoRoot, '.', '@biomejs/biome', 'bin/biome');
  runStep('biome', process.execPath, [biomeBin, '--version']);

  const workerdBin = resolvePackageBin(repoRoot, 'apps/web', 'workerd', 'bin/workerd');
  runStep('workerd', workerdBin, ['--version'], { cwd: join(repoRoot, 'apps/web') });

  const typescriptDir = firstInstallDirWithBin(['packages/contracts', '.'], 'typescript', 'bin/tsc');
  const tscBin = resolvePackageBin(repoRoot, typescriptDir, 'typescript', 'bin/tsc');
  runStep('typescript', process.execPath, [tscBin, '--version']);

  const viteDir = firstInstallDirWithBin(['apps/web', '.'], 'vite', 'bin/vite.js');
  const viteBin = resolvePackageBin(repoRoot, viteDir, 'vite', 'bin/vite.js');
  runStep('vite', process.execPath, [viteBin, '--version'], { cwd: join(repoRoot, 'apps/web') });
}

function rebuildWorkerd() {
  execSync('npm rebuild workerd --workspaces --if-present', { cwd: repoRoot, stdio: 'inherit' });
}

async function main() {
  const host = detectHost();
  console.log(`ensure-native-binaries: host=${host.os}/${host.arch}${host.libc ? `/${host.libc}` : ''}`);

  let missing = missingInstallTargets(host);
  if (missing.length) {
    console.log(
      `Missing ${missing.length} platform package(s): ${missing.map((t) => `${t.name}@${t.version} (${t.installDir})`).join(', ')}`,
    );
    await installTargets(missing);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
