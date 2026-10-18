import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** @typedef {{ os: 'darwin' | 'linux' | 'win32' | string, arch: string, libc?: 'gnu' | 'musl' }} HostPlatform */

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
 * @param {Record<string, { optionalDependencies?: Record<string, string> }>} packages
 * @param {HostPlatform} host
 * @returns {Map<string, string>}
 */
export function collectOptionalPlatformSpecs(packages, host) {
  const specs = new Map();
  for (const meta of Object.values(packages)) {
    const optional = meta.optionalDependencies;
    if (!optional) continue;
    for (const [name, version] of Object.entries(optional)) {
      if (!optionalPackageMatchesHost(name, host)) continue;
      specs.set(name, version);
    }
  }
  return specs;
}

/**
 * @param {string} packageName
 * @param {string} repoRoot
 */
export function isPackageInstalled(packageName, repoRoot) {
  const require = createRequire(join(repoRoot, 'package.json'));
  try {
    require.resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return existsSync(join(repoRoot, 'node_modules', ...packageName.split('/'), 'package.json'));
  }
}
