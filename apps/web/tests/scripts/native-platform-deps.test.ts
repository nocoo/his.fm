import { describe, expect, it } from 'vitest';
import {
  collectOptionalPlatformSpecs,
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

  it('collects platform specs from lockfile optionalDependencies', () => {
    const packages = {
      'node_modules/@biomejs/biome': {
        optionalDependencies: {
          '@biomejs/cli-linux-x64': '2.5.15',
          '@biomejs/cli-darwin-arm64': '2.5.15',
        },
      },
      'node_modules/workerd': {
        optionalDependencies: {
          '@cloudflare/workerd-linux-64': '1.2.3',
          '@cloudflare/workerd-darwin-arm64': '1.2.3',
        },
      },
    };
    const linux = collectOptionalPlatformSpecs(packages, { os: 'linux', arch: 'x64', libc: 'gnu' });
    expect(linux.get('@biomejs/cli-linux-x64')).toBe('2.5.15');
    expect(linux.get('@cloudflare/workerd-linux-64')).toBe('1.2.3');
    expect(linux.has('@biomejs/cli-darwin-arm64')).toBe(false);

    const mac = collectOptionalPlatformSpecs(packages, { os: 'darwin', arch: 'arm64' });
    expect(mac.get('@biomejs/cli-darwin-arm64')).toBe('2.5.15');
    expect(mac.has('@cloudflare/workerd-linux-64')).toBe(false);
  });
});
