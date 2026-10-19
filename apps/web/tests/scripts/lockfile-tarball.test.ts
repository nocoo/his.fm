import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertTarballArchiveSafe, assertTarballIntegrity } from '../../../../scripts/lockfile-tarball.mjs';
import {
  assertAllowedRegistryTarballUrl,
  loadAllowedRegistryHosts,
} from '../../../../scripts/registry-allowlist.mjs';

const repoRoot = join(import.meta.dirname, '../../../../');

describe('lockfile tarball integrity', () => {
  it('accepts a buffer matching the lockfile sha512', () => {
    const body = Buffer.from('verified package bytes');
    const digest = createHash('sha512').update(body).digest('base64');
    assertTarballIntegrity(body, `sha512-${digest}`);
  });

  it('rejects a tampered tarball', () => {
    const body = Buffer.from('verified package bytes');
    const digest = createHash('sha512').update(body).digest('base64');
    const tampered = Buffer.from('tampered package bytes');
    expect(() => assertTarballIntegrity(tampered, `sha512-${digest}`)).toThrow(/integrity check failed/i);
  });

  it('rejects missing integrity metadata', () => {
    expect(() => assertTarballIntegrity(Buffer.from('x'), '')).toThrow(/missing integrity/i);
  });

  it('rejects sha1 lockfile integrity', () => {
    expect(() => assertTarballIntegrity(Buffer.from('x'), 'sha1-abc=')).toThrow(
      /Unsupported integrity algorithm/i,
    );
  });
});

describe('registry tarball URL policy', () => {
  const hosts = loadAllowedRegistryHosts(repoRoot);

  it('allows https registry.npmjs.org tarball URLs', () => {
    expect(
      assertAllowedRegistryTarballUrl('https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz', hosts)
        .hostname,
    ).toBe('registry.npmjs.org');
  });

  it('rejects non-https, file, and foreign hosts', () => {
    expect(() => assertAllowedRegistryTarballUrl('http://registry.npmjs.org/pkg.tgz', hosts)).toThrow(
      /https/,
    );
    expect(() => assertAllowedRegistryTarballUrl('file:///etc/passwd', hosts)).toThrow(/https/);
    expect(() => assertAllowedRegistryTarballUrl('https://evil.example.invalid/pkg.tgz', hosts)).toThrow(
      /not allowlisted/i,
    );
  });
});

describe('tarball archive safety', () => {
  it('rejects archives that contain symbolic links', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-unsafe-tar-'));
    const pkgDir = join(staging, 'pkg');
    const archive = join(staging, 'evil.tgz');
    try {
      execFileSync('mkdir', ['-p', pkgDir]);
      writeFileSync(join(pkgDir, 'safe.txt'), 'ok');
      execFileSync('ln', ['-s', '../outside', join(pkgDir, 'escape')]);
      execFileSync('tar', ['-czf', archive, '-C', staging, 'pkg']);
      expect(() => assertTarballArchiveSafe(archive)).toThrow(/symbolic or hard links/i);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('rejects archives with parent traversal paths', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-unsafe-tar-'));
    const archive = join(staging, 'evil.tgz');
    const payload = join(staging, 'payload.txt');
    try {
      writeFileSync(payload, 'x');
      execFileSync('tar', ['-czf', archive, '--transform', 's,^,../escape/,', '-C', staging, 'payload.txt']);
      expect(() => assertTarballArchiveSafe(archive)).toThrow(/Unsafe tarball path/i);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('accepts a minimal safe package archive', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-safe-tar-'));
    const pkgDir = join(staging, 'pkg');
    const archive = join(staging, 'safe.tgz');
    try {
      execFileSync('mkdir', ['-p', join(pkgDir, 'lib')]);
      writeFileSync(join(pkgDir, 'package.json'), '{}');
      writeFileSync(join(pkgDir, 'lib', 'index.js'), 'export {};');
      execFileSync('tar', ['-czf', archive, '-C', staging, 'pkg']);
      expect(() => assertTarballArchiveSafe(archive)).not.toThrow();
      expect(readFileSync(archive).length).toBeGreaterThan(0);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
});
