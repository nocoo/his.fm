import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ os: 'darwin' | 'linux' | 'win32' | string, arch: string, libc?: 'gnu' | 'musl' }} HostPlatform */
/** @typedef {{ installDir: string, name: string, version: string, resolved: string, integrity: string, lockPath: string }} PlatformInstallTarget */

export function isMuslLinux() {
  try {
    const stderr = execSync('ldd --version', { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    return stderr.includes('musl');
  } catch (error) {
    const stderr = error.stderr?.toString() ?? '';
    return stderr.includes('musl');
  }
}

/** @returns {HostPlatform} */
export function detectHost() {
  const { platform, arch } = process;
  if (platform === 'linux') {
    return { os: 'linux', arch, libc: isMuslLinux() ? 'musl' : 'gnu' };
  }
  if (platform === 'darwin' || platform === 'win32') {
    return { os: platform, arch };
  }
  return { os: platform, arch };
}

/**
 * Whether an optional dependency package name targets the current host OS/CPU/libc.
 * @param {string} packageName
 * @param {HostPlatform} host
 */
export function optionalPackageMatchesHost(packageName, host) {
  const id = packageName.toLowerCase();

  if (host.os === 'darwin') {
    if (!id.includes('darwin')) return false;
    if (host.arch === 'arm64') return id.includes('arm64');
    if (host.arch === 'x64') return id.includes('darwin-x64');
    return id.includes(host.arch);
  }

  if (host.os === 'win32') {
    if (!id.includes('win32')) return false;
    return host.arch === 'arm64' ? id.includes('arm64') : id.includes('win32-x64');
  }

  if (host.os !== 'linux') return false;

  if (id.includes('darwin') || id.includes('win32') || id.includes('freebsd') || id.includes('android')) {
    return false;
  }

  if (host.libc === 'musl' && id.includes('gnu') && !id.includes('musl')) return false;
  if (host.libc === 'gnu' && id.includes('musl')) return false;

  if (host.arch === 'arm64') {
    if (id.includes('x64') && !id.includes('arm64') && !id.includes('aarch64')) return false;
    return id.includes('arm64') || id.includes('aarch64') || id.includes('arm-');
  }

  if (host.arch === 'x64') {
    if (id.includes('arm64') || id.includes('aarch64') || /linux-arm[^6]/.test(id)) return false;
    if (packageName === '@cloudflare/workerd-linux-64') return true;
    if (id.includes('linux-x64') || id.includes('linux_x64')) return true;
    if (id.includes('linux-64') && id.includes('workerd')) return true;
    if (id.includes('linux-x64-gnu') || id.includes('binding-linux-x64-gnu')) return true;
    if (packageName.startsWith('@typescript/typescript-linux-') && id.endsWith('-x64')) return true;
    if (packageName.startsWith('@img/sharp-linux-') && id.includes('x64')) return true;
  }

  return false;
}

/**
 * Directory (relative to repo root) whose `node_modules/` should hold the platform package.
 * @param {string} lockPath
 * @returns {string}
 */
export function installDirForLockPath(lockPath) {
  const idx = lockPath.indexOf('/node_modules/');
  if (idx === -1) return '.';
  const prefix = lockPath.slice(0, idx);
  return prefix || '.';
}

/**
 * @param {Record<string, { version?: string, resolved?: string, integrity?: string, optionalDependencies?: Record<string, string> }>} packages
 * @param {string} parentLockPath
 * @param {string} optionalName
 * @returns {{ lockPath: string, version: string, resolved: string, integrity: string }}
 */
function lockPathMatchesOptionalName(lockPath, optionalName) {
  return lockPath === `node_modules/${optionalName}` || lockPath.endsWith(`/node_modules/${optionalName}`);
}

export function resolveOptionalLockEntry(packages, parentLockPath, optionalName) {
  const direct = `${parentLockPath}/node_modules/${optionalName}`;
  const directMeta = packages[direct];
  if (directMeta?.integrity && directMeta.resolved && directMeta.version) {
    return {
      lockPath: direct,
      version: directMeta.version,
      resolved: directMeta.resolved,
      integrity: directMeta.integrity,
    };
  }

  const installDir = installDirForLockPath(parentLockPath);
  const candidates = Object.entries(packages).filter(
    ([lockPath, meta]) =>
      lockPathMatchesOptionalName(lockPath, optionalName) &&
      installDirForLockPath(lockPath) === installDir &&
      meta.integrity &&
      meta.resolved &&
      meta.version,
  );

  if (candidates.length === 0) {
    throw new Error(
      `No resolved lockfile entry with integrity for optional ${optionalName} (parent ${parentLockPath})`,
    );
  }

  if (candidates.length === 1) {
    const [lockPath, meta] = candidates[0];
    return {
      lockPath,
      version: meta.version,
      resolved: meta.resolved,
      integrity: meta.integrity,
    };
  }

  const underParent = candidates.find(([lockPath]) => lockPath.startsWith(`${parentLockPath}/`));
  if (underParent) {
    const [lockPath, meta] = underParent;
    return {
      lockPath,
      version: meta.version,
      resolved: meta.resolved,
      integrity: meta.integrity,
    };
  }

  throw new Error(`Ambiguous lockfile entries for optional ${optionalName} under ${parentLockPath}`);
}

/**
 * @param {Record<string, { optionalDependencies?: Record<string, string> }>} packages
 * @param {HostPlatform} host
 * @returns {PlatformInstallTarget[]}
 */
export function collectPlatformInstallTargets(packages, host) {
  /** @type {PlatformInstallTarget[]} */
  const targets = [];
  const seen = new Set();
  for (const [pkgPath, meta] of Object.entries(packages)) {
    const optional = meta.optionalDependencies;
    if (!optional) continue;
    const installDir = installDirForLockPath(pkgPath);
    for (const [name] of Object.entries(optional)) {
      if (!optionalPackageMatchesHost(name, host)) continue;
      const resolved = resolveOptionalLockEntry(packages, pkgPath, name);
      const key = `${installDir}\0${name}\0${resolved.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        installDir,
        name,
        version: resolved.version,
        resolved: resolved.resolved,
        integrity: resolved.integrity,
        lockPath: resolved.lockPath,
      });
    }
  }
  return targets;
}

/**
 * @param {string} installDir
 * @param {string} packageName
 * @param {string} repoRoot
 * @param {string} expectedVersion
 */
export function isPackageInstalledAt(installDir, packageName, repoRoot, expectedVersion) {
  const base = join(repoRoot, installDir);
  const localPkg = join(base, 'node_modules', ...packageName.split('/'), 'package.json');
  if (!existsSync(localPkg)) return false;
  try {
    const { version } = JSON.parse(readFileSync(localPkg, 'utf8'));
    return version === expectedVersion;
  } catch {
    return false;
  }
}

/**
 * @param {string} repoRoot
 * @param {string} installDir
 * @param {string} packageName
 * @param {string} binRelative path inside the package (e.g. bin/biome)
 */
export function resolvePackageBin(repoRoot, installDir, packageName, binRelative) {
  const binPath = join(repoRoot, installDir, 'node_modules', ...packageName.split('/'), binRelative);
  if (!existsSync(binPath)) {
    throw new Error(`Missing local binary at ${binPath}`);
  }
  return binPath;
}
