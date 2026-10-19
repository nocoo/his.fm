import { describe, expect, it } from 'vitest';
import {
  collectPlatformInstallTargets,
  installDirForLockPath,
  optionalPackageMatchesHost,
  resolveOptionalLockEntry,
} from '../../../../scripts/native-platform-deps.mjs';

const lockMeta = {
  resolved: 'https://registry.example.invalid/pkg-1.0.0.tgz',
  integrity:
    'sha512-xE4iEW/3LqlYj9GFgGrFsFSH51dEEpUbYWBfeOv0q87WkUDxK2o/HhreSb7qMJqck70RVM6Lg96hgedcAYcOkA==',
};

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

  it('collects targets from resolved lock entries, not optional version ranges', () => {
    const packages: Record<
      string,
      {
        version?: string;
        resolved?: string;
        integrity?: string;
        optionalDependencies?: Record<string, string>;
      }
    > = {
      'node_modules/workerd': {
        optionalDependencies: {
          '@cloudflare/workerd-linux-64': 'latest',
          '@cloudflare/workerd-darwin-arm64': '1.0.0',
        },
      },
      'node_modules/@cloudflare/workerd-linux-64': {
        version: '1.0.0',
        ...lockMeta,
      },
      'apps/web/node_modules/workerd': {
        optionalDependencies: {
          '@cloudflare/workerd-linux-64': '2.0.0',
        },
      },
      'apps/web/node_modules/@cloudflare/workerd-linux-64': {
        version: '2.0.0',
        resolved: 'https://registry.example.invalid/pkg-2.0.0.tgz',
        integrity:
          'sha512-IlxUcyxilVGPsE008x13pWdkTbU3nQpP2i9b5UrbOYj6goBkKsRX1XB7yJLcV+O1H9LBchIIm4adOaVLZBX0ZQ==',
      },
      'node_modules/@biomejs/biome': {
        optionalDependencies: {
          '@biomejs/cli-linux-x64': '2.5.15',
          '@biomejs/cli-darwin-arm64': '2.5.15',
        },
      },
      'node_modules/@biomejs/cli-linux-x64': {
        version: '2.5.15',
        resolved: 'https://registry.example.invalid/biome-cli.tgz',
        integrity:
          'sha512-xE4iEW/3LqlYj9GFgGrFsFSH51dEEpUbYWBfeOv0q87WkUDxK2o/HhreSb7qMJqck70RVM6Lg96hgedcAYcOkA==',
      },
    };
    const linux = collectPlatformInstallTargets(packages, { os: 'linux', arch: 'x64', libc: 'gnu' });
    expect(linux).toContainEqual({
      installDir: '.',
      name: '@cloudflare/workerd-linux-64',
      version: '1.0.0',
      resolved: lockMeta.resolved,
      integrity: lockMeta.integrity,
      lockPath: 'node_modules/@cloudflare/workerd-linux-64',
    });
    expect(linux).toContainEqual({
      installDir: 'apps/web',
      name: '@cloudflare/workerd-linux-64',
      version: '2.0.0',
      resolved: 'https://registry.example.invalid/pkg-2.0.0.tgz',
      integrity:
        'sha512-IlxUcyxilVGPsE008x13pWdkTbU3nQpP2i9b5UrbOYj6goBkKsRX1XB7yJLcV+O1H9LBchIIm4adOaVLZBX0ZQ==',
      lockPath: 'apps/web/node_modules/@cloudflare/workerd-linux-64',
    });
    expect(linux.some((target) => target.name.includes('darwin'))).toBe(false);
  });

  it('throws when optional platform package has no resolved lock entry', () => {
    const packages: Record<
      string,
      {
        version?: string;
        resolved?: string;
        integrity?: string;
        optionalDependencies?: Record<string, string>;
      }
    > = {
      'node_modules/workerd': {
        optionalDependencies: {
          '@cloudflare/workerd-linux-64': '1.0.0',
        },
      },
    };
    expect(() => collectPlatformInstallTargets(packages, { os: 'linux', arch: 'x64', libc: 'gnu' })).toThrow(
      /No resolved lockfile entry/,
    );
  });

  it('resolves hoisted optional packages under the parent install directory', () => {
    const packages: Record<
      string,
      {
        version?: string;
        resolved?: string;
        integrity?: string;
        optionalDependencies?: Record<string, string>;
      }
    > = {
      'node_modules/@biomejs/biome': {
        optionalDependencies: {
          '@biomejs/cli-linux-x64': '2.5.15',
        },
      },
      'node_modules/@biomejs/cli-linux-x64': {
        version: '2.5.15',
        resolved: 'https://registry.example.invalid/biome-cli.tgz',
        integrity: lockMeta.integrity,
      },
    };
    expect(
      resolveOptionalLockEntry(packages, 'node_modules/@biomejs/biome', '@biomejs/cli-linux-x64'),
    ).toEqual({
      lockPath: 'node_modules/@biomejs/cli-linux-x64',
      version: '2.5.15',
      resolved: 'https://registry.example.invalid/biome-cli.tgz',
      integrity: lockMeta.integrity,
    });
  });
});
