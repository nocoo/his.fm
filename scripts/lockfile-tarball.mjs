import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, normalize as posixNormalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAllowedRegistryTarballUrl, loadAllowedRegistryHosts } from './registry-allowlist.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const fetchAttempts = 5;
const fetchBackoffMs = [0, 4_000, 12_000, 24_000, 40_000];

/**
 * @param {string} integrity npm lockfile integrity (e.g. sha512-Base64...)
 * @param {Buffer} body
 */
export function assertTarballIntegrity(body, integrity) {
  if (!integrity || typeof integrity !== 'string') {
    throw new Error('Lockfile entry is missing integrity');
  }
  const dash = integrity.indexOf('-');
  if (dash === -1) {
    throw new Error(`Unsupported integrity format: ${integrity}`);
  }
  const algo = integrity.slice(0, dash);
  const encoded = integrity.slice(dash + 1);
  if (algo !== 'sha512') {
    throw new Error(`Unsupported integrity algorithm: ${algo}`);
  }
  const expected = Buffer.from(encoded, 'base64');
  const actual = createHash('sha512').update(body).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Tarball integrity check failed');
  }
}

/**
 * @param {string} archivePath
 */
export function assertTarballArchiveSafe(archivePath) {
  const names = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const rawName of names) {
    const name = rawName.replace(/^\.\//, '');
    if (posix.isAbsolute(name) || name.startsWith('../') || name.split('/').includes('..')) {
      throw new Error(`Unsafe tarball path: ${rawName}`);
    }
    const normalized = posixNormalize(name);
    if (normalized.startsWith('..') || normalized.includes('/../')) {
      throw new Error(`Unsafe tarball path: ${rawName}`);
    }
  }

  const verbose = execFileSync('tar', ['-tvf', archivePath], { encoding: 'utf8' });
  for (const line of verbose.split('\n')) {
    if (!line) continue;
    const type = line[0];
    if (type === 'l' || type === 'h') {
      throw new Error('Tarball contains symbolic or hard links');
    }
  }
}

/**
 * @param {string} resolved
 * @param {string} integrity
 * @param {Set<string>} [allowedHosts]
 * @returns {Promise<Buffer>}
 */
export async function fetchLockedTarball(
  resolved,
  integrity,
  allowedHosts = loadAllowedRegistryHosts(repoRoot),
) {
  assertAllowedRegistryTarballUrl(resolved, allowedHosts);
  let lastError;
  const staging = mkdtempSync(join(tmpdir(), 'hisfm-fetch-'));
  const archive = join(staging, 'package.tgz');
  try {
    for (let attempt = 0; attempt < fetchAttempts; attempt++) {
      if (fetchBackoffMs[attempt]) {
        execFileSync('sleep', [String(Math.ceil(fetchBackoffMs[attempt] / 1000))], { stdio: 'inherit' });
      }
      try {
        execFileSync(
          'curl',
          [
            '--fail',
            '--silent',
            '--show-error',
            '--max-redirs',
            '0',
            '--retry',
            '3',
            '--retry-delay',
            '5',
            '--connect-timeout',
            '60',
            '--max-time',
            '600',
            '-o',
            archive,
            resolved,
          ],
          { stdio: 'inherit' },
        );
        assertTarballArchiveSafe(archive);
        const body = readFileSync(archive);
        assertTarballIntegrity(body, integrity);
        return body;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error(`Failed to fetch ${resolved}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * @param {Buffer} tarball
 * @param {string} targetDir absolute path to package root (node_modules/name)
 */
export function extractTarballIntoPackageDir(tarball, targetDir) {
  const staging = mkdtempSync(join(tmpdir(), 'hisfm-tar-'));
  try {
    const archive = join(staging, 'package.tgz');
    writeFileSync(archive, tarball);
    assertTarballArchiveSafe(archive);
    rmSync(targetDir, { recursive: true, force: true });
    execFileSync('mkdir', ['-p', targetDir]);
    execFileSync('tar', ['-xzf', archive, '-C', targetDir, '--strip-components=1'], { stdio: 'inherit' });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
