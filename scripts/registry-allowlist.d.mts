export function loadAllowedRegistryHosts(repoRoot: string): Set<string>;
export function assertAllowedRegistryTarballUrl(resolved: string, allowedHosts: Set<string>): URL;
