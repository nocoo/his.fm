import { describe, expect, it } from 'vitest';
import {
  collectPlatformInstallTargets,
  installDirForLockPath,
  optionalPackageMatchesHost,
} from '../../../../scripts/native-platform-deps.mjs';

describe('native platform optional dependencies', () => {
  it('matches linux x64 gnu toolchain packages', () => {
    const host = { os: 'linux', arch: 'x64', libc: 'gnu' as const };
    for (const name of [
      '@biomejs/cli-linux-x64',
      '@cloudflare/workerd-linux-64',
      '@typescript/typescript-linux-x64',
      'lightningcss-linux-x64-gnu',
      '@rolldown/binding-linux-x64-gnu',
      '@img/sharp-linux-x64',
    ]) {
      expect(optionalPackageMatchesHost(name, host)).toBe(true);
    }
    for (const name of [
      '@biomejs/cli-linux-x64-musl',
      '@biomejs/cli-darwin-arm64',
      '@cloudflare/workerd-darwin-arm64',
      'lightningcss-linux-arm64-gnu',
    ]) {
      expect(optionalPackageMatchesHost(name, host)).toBe(false);
    }
  });

  it('matches darwin arm64 without linux binaries', () => {
    const host = { os: 'darwin', arch: 'arm64' };
    expect(optionalPackageMatchesHost('@biomejs/cli-darwin-arm64', host)).toBe(true);
    expect(optionalPackageMatchesHost('@biomejs/cli-linux-x64', host)).toBe(false);
  });

  it('maps lockfile paths to install directories', () => {
    expect(installDirForLockPath('node_modules/@biomejs/biome')).toBe('.');
    expect(installDirForLockPath('apps/web/node_modules/workerd')).toBe('apps/web');
    expect(installDirForLockPath('packages/contracts/node_modules/typescript')).toBe('packages/contracts');
    expect(installDirForLockPath('node_modules/cf/node_modules/workerd')).toBe('node_modules/cf');
  });

  it('collects per-workspace platform specs with every required version', () => {
    const packages = {
      'node_modules/workerd': {
        optionalDependencies: {
          '@cloudflare/workerd-linux-64': '1.0.0',
          '@cloudflare/workerd-darwin-arm64': '1.0.0',
        },
      },
      'apps/web/node_modules/workerd': {
        optionalDependencies: {
          '@cloudflare/workerd-linux-64': '2.0.0',
        },
      },
      'node_modules/@biomejs/biome': {
        optionalDependencies: {
          '@biomejs/cli-linux-x64': '2.5.15',
          '@biomejs/cli-darwin-arm64': '2.5.15',
        },
      },
    };
    const linux = collectPlatformInstallTargets(packages, { os: 'linux', arch: 'x64', libc: 'gnu' });
    expect(linux).toContainEqual({
      installDir: '.',
      name: '@cloudflare/workerd-linux-64',
      version: '1.0.0',
    });
    expect(linux).toContainEqual({
      installDir: 'apps/web',
      name: '@cloudflare/workerd-linux-64',
      version: '2.0.0',
    });
    expect(linux).toContainEqual({
      installDir: '.',
      name: '@biomejs/cli-linux-x64',
      version: '2.5.15',
    });
    expect(linux.some((target) => target.name.includes('darwin'))).toBe(false);
  });
});
