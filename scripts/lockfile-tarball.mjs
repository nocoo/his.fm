import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
 * @param {string} resolved
 * @param {string} integrity
 * @returns {Promise<Buffer>}
 */
export async function fetchLockedTarball(resolved, integrity) {
  if (!resolved) {
    throw new Error('Lockfile entry is missing resolved tarball URL');
  }
  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${resolved}: HTTP ${response.status}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  assertTarballIntegrity(body, integrity);
  return body;
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
    rmSync(targetDir, { recursive: true, force: true });
    execFileSync('mkdir', ['-p', targetDir]);
    execFileSync('tar', ['-xzf', archive, '-C', targetDir, '--strip-components=1'], { stdio: 'inherit' });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
