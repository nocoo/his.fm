import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_HOSTS = ['registry.npmjs.org', 'mirrors.tencent.com'];

/**
 * Hostnames permitted for lockfile tarball downloads (https only).
 * @param {string} repoRoot
 * @returns {Set<string>}
 */
export function loadAllowedRegistryHosts(repoRoot) {
  const hosts = new Set(DEFAULT_HOSTS);
  const npmrcPath = join(repoRoot, '.npmrc');
  if (!existsSync(npmrcPath)) {
    return hosts;
  }
  const npmrc = readFileSync(npmrcPath, 'utf8');
  for (const line of npmrc.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const registryMatch = trimmed.match(/^registry\s*=\s*(.+)$/);
    if (!registryMatch) continue;
    try {
      hosts.add(new URL(registryMatch[1].trim()).hostname);
    } catch {
      throw new Error(`Invalid registry URL in .npmrc: ${registryMatch[1]}`);
    }
  }
  return hosts;
}

/**
 * @param {string} resolved
 * @param {Set<string>} allowedHosts
 */
export function assertAllowedRegistryTarballUrl(resolved, allowedHosts) {
  if (!resolved || typeof resolved !== 'string') {
    throw new Error('Lockfile entry is missing resolved tarball URL');
  }
  let url;
  try {
    url = new URL(resolved);
  } catch {
    throw new Error(`Invalid resolved tarball URL: ${resolved}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Resolved tarball URL must use https: ${resolved}`);
  }
  if (url.username || url.password) {
    throw new Error('Resolved tarball URL must not include credentials');
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`Resolved tarball host is not allowlisted: ${url.hostname}`);
  }
  return url;
}
