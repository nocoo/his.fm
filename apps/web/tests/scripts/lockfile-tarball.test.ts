import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

import * as lockfileTarball from '../../../../scripts/lockfile-tarball.mjs';
import {
  assertAllowedRegistryTarballUrl,
  loadAllowedRegistryHosts,
  normalizeAllowedRegistryTarballUrl,
} from '../../../../scripts/registry-allowlist.mjs';
import {
  buildGzipTarball,
  hardlinkEscapeTarball,
  minimalSafePackageTarball,
  parentTraversalTarball,
} from './tar-fixtures';

const repoRoot = join(import.meta.dirname, '../../../../');

describe('lockfile tarball integrity', () => {
  it('accepts a buffer matching the lockfile sha512', () => {
    const body = Buffer.from('verified package bytes');
    const digest = createHash('sha512').update(body).digest('base64');
    lockfileTarball.assertTarballIntegrity(body, `sha512-${digest}`);
  });

  it('rejects a tampered tarball', () => {
    const body = Buffer.from('verified package bytes');
    const digest = createHash('sha512').update(body).digest('base64');
    const tampered = Buffer.from('tampered package bytes');
    expect(() => lockfileTarball.assertTarballIntegrity(tampered, `sha512-${digest}`)).toThrow(
      /integrity check failed/i,
    );
  });

  it('rejects missing integrity metadata', () => {
    expect(() => lockfileTarball.assertTarballIntegrity(Buffer.from('x'), '')).toThrow(/missing integrity/i);
  });

  it('rejects sha1 lockfile integrity', () => {
    expect(() => lockfileTarball.assertTarballIntegrity(Buffer.from('x'), 'sha1-abc=')).toThrow(
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

  it('rejects ambiguous URLs that could disagree between validation and curl', () => {
    const tricky = 'https://registry.npmjs.org@not-allowlisted.invalid/package.tgz';
    expect(() => normalizeAllowedRegistryTarballUrl(tricky, hosts)).toThrow(/userinfo|not canonical/i);
    expect(() =>
      normalizeAllowedRegistryTarballUrl('https://registry.npmjs.org\\@evil.invalid/pkg.tgz', hosts),
    ).toThrow(/backslash/i);
    expect(() => normalizeAllowedRegistryTarballUrl('https://registry.npmjs.org/pkg.tgz ', hosts)).toThrow(
      /whitespace/i,
    );
  });
});

describe('fetchLockedTarball download path', () => {
  const hosts = loadAllowedRegistryHosts(repoRoot);
  const canonical = 'https://registry.npmjs.org/@scope/safe/-/safe-1.0.0.tgz';
  let realExecFileSync: typeof import('node:child_process').execFileSync;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    realExecFileSync = actual.execFileSync;
    execFileSyncMock.mockImplementation(realExecFileSync);
  });

  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  function integrityFor(body: Buffer): string {
    return `sha512-${createHash('sha512').update(body).digest('base64')}`;
  }

  function mockCurlDownloads(body: Buffer) {
    execFileSyncMock.mockImplementation((file, args, options) => {
      if (file === 'sleep') {
        return Buffer.alloc(0);
      }
      if (file === 'curl') {
        const curlArgs = args as string[];
        const outputIndex = curlArgs.indexOf('-o');
        const outputPath = outputIndex >= 0 ? curlArgs[outputIndex + 1] : undefined;
        if (outputPath) {
          writeFileSync(outputPath, body);
        }
        return Buffer.alloc(0);
      }
      return realExecFileSync(
        file,
        args as readonly string[],
        options as import('node:child_process').ExecFileSyncOptions,
      );
    });
  }

  function curlInvocations() {
    return execFileSyncMock.mock.calls.filter((call) => call[0] === 'curl');
  }

  it('passes only the normalized URL to curl on the download path', async () => {
    const body = minimalSafePackageTarball();
    mockCurlDownloads(body);

    await lockfileTarball.fetchLockedTarball(canonical, integrityFor(body), hosts);

    const curls = curlInvocations();
    expect(curls.length).toBeGreaterThan(0);
    for (const [, curlArgs] of curls) {
      expect((curlArgs as string[]).at(-1)).toBe(canonical);
    }
  });

  it('rejects file:, http:, and non-canonical hosts before downloading', async () => {
    mockCurlDownloads(minimalSafePackageTarball());

    await expect(
      lockfileTarball.fetchLockedTarball('file:///tmp/evil.tgz', 'sha512-abc', hosts),
    ).rejects.toThrow(/https/i);
    await expect(
      lockfileTarball.fetchLockedTarball('http://registry.npmjs.org/pkg.tgz', 'sha512-abc', hosts),
    ).rejects.toThrow(/https/i);
    await expect(
      lockfileTarball.fetchLockedTarball(
        'https://registry.npmjs.org@not-allowlisted.invalid/package.tgz',
        'sha512-abc',
        hosts,
      ),
    ).rejects.toThrow(/userinfo|not canonical/i);

    expect(curlInvocations()).toHaveLength(0);
  });

  it('configures curl to refuse cross-host redirects', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-curl-'));
    const out = join(staging, 'out.tgz');
    execFileSyncMock.mockImplementation(() => Buffer.alloc(0));
    try {
      lockfileTarball.downloadTarballToFile(canonical, out);
      const curlArgs = execFileSyncMock.mock.calls.find((call) => call[0] === 'curl')?.[1] as
        | string[]
        | undefined;
      expect(curlArgs).toBeDefined();
      const maxRedirsIndex = curlArgs?.indexOf('--max-redirs') ?? -1;
      expect(maxRedirsIndex).toBeGreaterThanOrEqual(0);
      expect(curlArgs?.[maxRedirsIndex + 1]).toBe('0');
      expect(curlArgs?.at(-1)).toBe(canonical);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
});

describe('tarball archive safety', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    execFileSyncMock.mockImplementation(actual.execFileSync);
  });

  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  it('rejects archives that contain symbolic links', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-unsafe-tar-'));
    const archive = join(staging, 'evil.tgz');
    try {
      writeFileSync(
        archive,
        buildGzipTarball([{ name: 'package/link', typeflag: '2', linkname: '../outside' }]),
      );
      expect(() => lockfileTarball.assertTarballArchiveSafe(archive)).toThrow(/symbolic or hard links/i);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('rejects archives with parent traversal paths', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-unsafe-tar-'));
    const archive = join(staging, 'evil.tgz');
    try {
      writeFileSync(archive, parentTraversalTarball());
      expect(() => lockfileTarball.assertTarballArchiveSafe(archive)).toThrow(/Unsafe tarball path/i);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('rejects archives that contain hard links', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-unsafe-tar-'));
    const archive = join(staging, 'evil.tgz');
    try {
      writeFileSync(archive, hardlinkEscapeTarball());
      expect(() => lockfileTarball.assertTarballArchiveSafe(archive)).toThrow(/symbolic or hard links/i);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('accepts a minimal safe package archive', () => {
    const staging = mkdtempSync(join(tmpdir(), 'hisfm-safe-tar-'));
    const archive = join(staging, 'safe.tgz');
    try {
      writeFileSync(archive, minimalSafePackageTarball());
      expect(() => lockfileTarball.assertTarballArchiveSafe(archive)).not.toThrow();
      expect(readFileSync(archive).length).toBeGreaterThan(0);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
});
