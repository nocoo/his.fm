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
      hosts.add(new URL(registryMatch[1].trim()).hostname.toLowerCase());
    } catch {
      throw new Error(`Invalid registry URL in .npmrc: ${registryMatch[1]}`);
    }
  }
  return hosts;
}

/**
 * @param {string} resolved
 * @param {Set<string>} allowedHosts
 * @returns {string} canonical https URL safe to pass to curl
 */
export function normalizeAllowedRegistryTarballUrl(resolved, allowedHosts) {
  if (!resolved || typeof resolved !== 'string') {
    throw new Error('Lockfile entry is missing resolved tarball URL');
  }
  if (resolved !== resolved.trim()) {
    throw new Error('Resolved tarball URL must not include leading or trailing whitespace');
  }
  if (resolved.includes('\\')) {
    throw new Error('Resolved tarball URL must not include backslashes');
  }
  if (/\s/.test(resolved)) {
    throw new Error('Resolved tarball URL must not include whitespace');
  }

  const schemeEnd = resolved.indexOf('://');
  if (schemeEnd === -1) {
    throw new Error(`Invalid resolved tarball URL: ${resolved}`);
  }
  const authorityStart = schemeEnd + 3;
  const pathStart = resolved.indexOf('/', authorityStart);
  const authority =
    pathStart === -1 ? resolved.slice(authorityStart) : resolved.slice(authorityStart, pathStart);
  if (authority.includes('@')) {
    throw new Error('Resolved tarball URL must not include userinfo in the authority');
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
  if (url.hash) {
    throw new Error('Resolved tarball URL must not include a fragment');
  }

  const host = url.hostname.toLowerCase();
  if (!allowedHosts.has(host)) {
    throw new Error(`Resolved tarball host is not allowlisted: ${url.hostname}`);
  }
  if (url.port && url.port !== '443') {
    throw new Error('Resolved tarball URL must use the default https port');
  }

  const canonical = `https://${host}${url.pathname}${url.search}`;
  if (resolved !== canonical) {
    throw new Error(`Resolved tarball URL is not canonical; expected ${canonical}`);
  }
  if (!url.pathname.endsWith('.tgz')) {
    throw new Error('Resolved tarball URL must end with .tgz');
  }

  return canonical;
}

/**
 * @param {string} resolved
 * @param {Set<string>} allowedHosts
 * @returns {URL}
 */
export function assertAllowedRegistryTarballUrl(resolved, allowedHosts) {
  return new URL(normalizeAllowedRegistryTarballUrl(resolved, allowedHosts));
}
