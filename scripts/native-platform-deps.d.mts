export type HostPlatform = { os: string; arch: string; libc?: 'gnu' | 'musl' };

export function isMuslLinux(): boolean;
export function detectHost(): HostPlatform;
export function optionalPackageMatchesHost(packageName: string, host: HostPlatform): boolean;
export function collectOptionalPlatformSpecs(
  packages: Record<string, { optionalDependencies?: Record<string, string> }>,
  host: HostPlatform,
): Map<string, string>;
export function isPackageInstalled(packageName: string, repoRoot: string): boolean;
