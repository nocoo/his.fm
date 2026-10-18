export type HostPlatform = { os: string; arch: string; libc?: 'gnu' | 'musl' };

export type PlatformInstallTarget = { installDir: string; name: string; version: string };

export function isMuslLinux(): boolean;
export function detectHost(): HostPlatform;
export function optionalPackageMatchesHost(packageName: string, host: HostPlatform): boolean;
export function installDirForLockPath(lockPath: string): string;
export function collectPlatformInstallTargets(
  packages: Record<string, { optionalDependencies?: Record<string, string> }>,
  host: HostPlatform,
): PlatformInstallTarget[];
export function isPackageInstalledAt(
  installDir: string,
  packageName: string,
  repoRoot: string,
  expectedVersion: string,
): boolean;
