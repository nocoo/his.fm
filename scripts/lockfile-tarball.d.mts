export function assertTarballIntegrity(body: Buffer, integrity: string): void;
export function fetchLockedTarball(resolved: string, integrity: string): Promise<Buffer>;
export function extractTarballIntoPackageDir(tarball: Buffer, targetDir: string): void;
